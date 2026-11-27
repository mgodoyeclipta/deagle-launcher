//! Downloads and installs the official Xash3D FWGS engine and cs16-client
//! from their GitHub releases into the launcher's own data folder, like a
//! Minecraft launcher installs game versions.
//!
//! Only open-source binaries are downloaded, from their official releases,
//! and each file is checked against the SHA-256 GitHub publishes for it.
//! Game data (valve/, cstrike/ maps, models, sounds) is never downloaded:
//! it comes from the user's Steam copy through `-rodir`.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, Runtime};

const API: &str = "https://api.github.com";
const ENGINE_REPO: &str = "FWGS/xash3d-fwgs";
const ENGINE_ASSET: &str = "xash3d-fwgs-apple-arm64.tar.xz";
const CLIENT_REPO: &str = "Velaron/cs16-client";
const CLIENT_ASSET: &str = "CS16Client-macOS-arm64.zip";
const RELEASE_TAG: &str = "continuous";

const OFFICIAL: &str = "oficial";
const MANIFEST: &str = "deagle-install.json";
/// Downloads bigger than this are refused (today they are ~5 and ~16 MB).
const MAX_DOWNLOAD: u64 = 200 * 1024 * 1024;

#[derive(Deserialize)]
struct Release {
    published_at: String,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

#[derive(Deserialize)]
struct CommitRef {
    sha: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallManifest {
    pub engine_commit: String,
    pub engine_published_at: String,
    pub client_published_at: String,
    /// Unix seconds.
    pub installed_at: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OfficialInstall {
    pub game_dir: String,
    pub manifest: InstallManifest,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    /// "engine" | "client" | "extract" | "done"
    step: &'static str,
    label: String,
    downloaded: u64,
    total: u64,
}

/// Only one install at a time.
static INSTALLING: AtomicBool = AtomicBool::new(false);

fn installs_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("installs"))
}

/// The managed install, if one has been completed.
pub fn official<R: Runtime>(app: &AppHandle<R>) -> Option<OfficialInstall> {
    let dir = installs_dir(app).ok()?.join(OFFICIAL);
    let manifest = read_manifest(&dir)?;
    Some(OfficialInstall { game_dir: dir.display().to_string(), manifest })
}

const PREVIOUS: &str = "oficial.anterior";

/// User files that should follow the player when switching versions, even
/// if the other version already has its own (older) copy.
const USER_FILES: &[&str] = &[
    "cstrike/config.cfg",
    "cstrike/config.cfg.deagle.bak",
    "cstrike/video.cfg",
    "cstrike/opengl.cfg",
    "cstrike/history_servers.lst",
];

fn read_manifest(dir: &Path) -> Option<InstallManifest> {
    serde_json::from_slice(&fs::read(dir.join(MANIFEST)).ok()?).ok()
}

/// The version kept from before the last update, if any.
pub fn previous<R: Runtime>(app: &AppHandle<R>) -> Option<InstallManifest> {
    read_manifest(&installs_dir(app).ok()?.join(PREVIOUS))
}

/// Brings the player's own files (configs, history, downloaded maps, bot
/// data) from `from` into `to`: copies what `to` lacks and overwrites the
/// known config files with the newer ones.
fn sync_user_files(from: &Path, to: &Path) -> Result<(), String> {
    carry_over_user_files(from, to)?;
    for rel in USER_FILES {
        let src = from.join(rel);
        if src.is_file() {
            let dst = to.join(rel);
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(&src, &dst).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Swaps the current official install with the previous one. Calling it
/// again undoes it, so nothing is ever lost.
fn swap_with_previous(root: &Path) -> Result<(), String> {
    let current = root.join(OFFICIAL);
    let previous = root.join(PREVIOUS);
    let parking = root.join(".swap");
    if read_manifest(&previous).is_none() {
        return Err("No hay una versión anterior guardada".into());
    }
    if read_manifest(&current).is_none() {
        return Err("No hay una instalación oficial".into());
    }
    sync_user_files(&current, &previous)?;
    let _ = fs::remove_dir_all(&parking);
    fs::rename(&current, &parking).map_err(|e| e.to_string())?;
    if let Err(e) = fs::rename(&previous, &current) {
        let _ = fs::rename(&parking, &current); // put things back as they were
        return Err(e.to_string());
    }
    fs::rename(&parking, &previous).map_err(|e| e.to_string())
}

pub fn rollback_official<R: Runtime>(app: &AppHandle<R>) -> Result<OfficialInstall, String> {
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err("Ya hay una instalación en curso".into());
    }
    let result = installs_dir(app).and_then(|root| {
        swap_with_previous(&root)?;
        official(app).ok_or_else(|| "La instalación quedó incompleta".to_string())
    });
    INSTALLING.store(false, Ordering::SeqCst);
    result
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("DeagleLauncher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

async fn github<T: for<'de> Deserialize<'de>>(client: &reqwest::Client, path: &str) -> Result<T, String> {
    let res = client
        .get(format!("{API}/{path}"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar con GitHub: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("GitHub respondió {} para {path}", res.status()));
    }
    res.json().await.map_err(|e| e.to_string())
}

fn pick_asset<'a>(release: &'a Release, name: &str) -> Result<&'a Asset, String> {
    release
        .assets
        .iter()
        .find(|a| a.name == name)
        .ok_or_else(|| format!("La release oficial no tiene {name}"))
}

/// `sha256:<hex>` as published by GitHub for each release asset.
fn expected_sha256(asset: &Asset) -> Result<String, String> {
    asset
        .digest
        .as_deref()
        .and_then(|d| d.strip_prefix("sha256:"))
        .filter(|hex| hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit()))
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| format!("GitHub no publica el SHA-256 de {}; no se instala sin verificar", asset.name))
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

async fn download<R: Runtime>(
    app: &AppHandle<R>,
    client: &reqwest::Client,
    asset: &Asset,
    step: &'static str,
    label: &str,
) -> Result<Vec<u8>, String> {
    if asset.size > MAX_DOWNLOAD {
        return Err(format!("{} es demasiado grande ({} bytes)", asset.name, asset.size));
    }
    let res = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|e| format!("No se pudo descargar {}: {e}", asset.name))?;
    if !res.status().is_success() {
        return Err(format!("La descarga de {} respondió {}", asset.name, res.status()));
    }

    let total = res.content_length().unwrap_or(asset.size);
    let mut bytes = Vec::with_capacity(total as usize);
    let mut stream = res.bytes_stream();
    let mut last_emit = Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Se cortó la descarga de {}: {e}", asset.name))?;
        bytes.extend_from_slice(&chunk);
        if bytes.len() as u64 > MAX_DOWNLOAD {
            return Err(format!("{} superó el tamaño máximo", asset.name));
        }
        if last_emit.elapsed() > Duration::from_millis(100) {
            last_emit = Instant::now();
            let _ = app.emit("install-progress", Progress { step, label: label.into(), downloaded: bytes.len() as u64, total });
        }
    }
    let _ = app.emit("install-progress", Progress { step, label: label.into(), downloaded: bytes.len() as u64, total });

    let expected = expected_sha256(asset)?;
    let actual = sha256_hex(&bytes);
    if actual != expected {
        return Err(format!("{} no coincide con el SHA-256 oficial; se descartó la descarga", asset.name));
    }
    Ok(bytes)
}

fn extract_tar_xz(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut tar_bytes = Vec::new();
    lzma_rs::xz_decompress(&mut Cursor::new(bytes), &mut tar_bytes).map_err(|e| format!("Archivo del motor dañado: {e:?}"))?;
    let mut archive = tar::Archive::new(Cursor::new(tar_bytes));
    archive.set_preserve_permissions(true);
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        // unpack_in refuses paths that would escape `dest`.
        if !entry.unpack_in(dest).map_err(|e| e.to_string())? {
            return Err("El archivo del motor tiene rutas inválidas".into());
        }
    }
    Ok(())
}

fn extract_zip(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("Archivo de cs16-client dañado: {e}"))?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = file.enclosed_name() else {
            return Err("El archivo de cs16-client tiene rutas inválidas".into());
        };
        let out = dest.join(rel);
        if file.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if file.is_symlink() {
            return Err("El archivo de cs16-client trae enlaces simbólicos inesperados".into());
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut data = Vec::new();
        file.read_to_end(&mut data).map_err(|e| e.to_string())?;
        fs::write(&out, data).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        if let Some(mode) = file.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&out, fs::Permissions::from_mode(mode & 0o755));
        }
    }
    Ok(())
}

/// Copies files the user made in the previous install (configs, server
/// history, downloaded maps, bot data) into the new one, without
/// overwriting anything the new packages provide.
fn carry_over_user_files(old: &Path, new: &Path) -> Result<(), String> {
    for game in ["cstrike", "valve"] {
        copy_missing(&old.join(game), &new.join(game))?;
    }
    Ok(())
}

fn copy_missing(from: &Path, to: &Path) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(from) else { return Ok(()) };
    for entry in entries.flatten() {
        let src = entry.path();
        let dst = to.join(entry.file_name());
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            copy_missing(&src, &dst)?;
        } else if !dst.exists() {
            fs::create_dir_all(to).map_err(|e| e.to_string())?;
            fs::copy(&src, &dst).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn finish_install(staging: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let engine = staging.join("xash3d");
    let mut perms = fs::metadata(&engine).map_err(|e| e.to_string())?.permissions();
    perms.set_mode(perms.mode() | 0o755);
    fs::set_permissions(&engine, perms).map_err(|e| e.to_string())?;
    // Our downloads aren't quarantined, but clear it anyway to be safe.
    let _ = std::process::Command::new("/usr/bin/xattr").args(["-dr", "com.apple.quarantine"]).arg(staging).status();
    Ok(())
}

fn is_plain_child(base: &Path, path: &Path) -> bool {
    path.strip_prefix(base).is_ok_and(|rel| rel.components().all(|c| matches!(c, Component::Normal(_))))
}

pub async fn install_official<R: Runtime>(app: &AppHandle<R>) -> Result<OfficialInstall, String> {
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err("Ya hay una instalación en curso".into());
    }
    let result = run_install(app).await;
    INSTALLING.store(false, Ordering::SeqCst);
    result
}

async fn run_install<R: Runtime>(app: &AppHandle<R>) -> Result<OfficialInstall, String> {
    let client = http()?;
    let engine_release: Release = github(&client, &format!("repos/{ENGINE_REPO}/releases/tags/{RELEASE_TAG}")).await?;
    let client_release: Release = github(&client, &format!("repos/{CLIENT_REPO}/releases/tags/{RELEASE_TAG}")).await?;
    let engine_commit: CommitRef = github(&client, &format!("repos/{ENGINE_REPO}/commits/{RELEASE_TAG}")).await?;
    let engine_asset = pick_asset(&engine_release, ENGINE_ASSET)?;
    let client_asset = pick_asset(&client_release, CLIENT_ASSET)?;

    let engine_bytes = download(app, &client, engine_asset, "engine", "Motor Xash3D FWGS").await?;
    let client_bytes = download(app, &client, client_asset, "client", "cs16-client").await?;

    let root = installs_dir(app)?;
    let staging = root.join(".staging");
    let official_dir = root.join(OFFICIAL);
    let previous = root.join(PREVIOUS);
    for dir in [&staging, &official_dir, &previous] {
        if !is_plain_child(&root, dir) {
            return Err("Ruta de instalación inesperada".into());
        }
    }

    let _ = app.emit("install-progress", Progress { step: "extract", label: "Instalando".into(), downloaded: 0, total: 0 });
    let staging_for_task = staging.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let _ = fs::remove_dir_all(&staging_for_task);
        fs::create_dir_all(&staging_for_task).map_err(|e| e.to_string())?;
        extract_tar_xz(&engine_bytes, &staging_for_task)?;
        extract_zip(&client_bytes, &staging_for_task)?;
        finish_install(&staging_for_task)
    })
    .await
    .map_err(|e| e.to_string())??;

    if official_dir.is_dir() {
        sync_user_files(&official_dir, &staging)?;
    }

    let manifest = InstallManifest {
        engine_commit: engine_commit.sha.chars().take(7).collect(),
        engine_published_at: engine_release.published_at.clone(),
        client_published_at: client_release.published_at.clone(),
        installed_at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
    };
    fs::write(staging.join(MANIFEST), serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;

    // Swap in the new install; keep the previous one for rolling back.
    if official_dir.is_dir() {
        let _ = fs::remove_dir_all(&previous);
        fs::rename(&official_dir, &previous).map_err(|e| e.to_string())?;
    }
    fs::rename(&staging, &official_dir).map_err(|e| e.to_string())?;

    let _ = app.emit("install-progress", Progress { step: "done", label: "Listo".into(), downloaded: 0, total: 0 });
    Ok(OfficialInstall { game_dir: official_dir.display().to_string(), manifest })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(digest: Option<&str>) -> Asset {
        Asset { name: "x.zip".into(), browser_download_url: String::new(), size: 1, digest: digest.map(String::from) }
    }

    #[test]
    fn requires_a_published_sha256() {
        let hex = "a8e9a6ff342fa6882611c17562394eeec4f0c2f1368a16a9581df2080bb8ac33";
        assert_eq!(expected_sha256(&asset(Some(&format!("sha256:{hex}")))).unwrap(), hex);
        assert!(expected_sha256(&asset(None)).is_err());
        assert!(expected_sha256(&asset(Some("md5:abc"))).is_err());
        assert!(expected_sha256(&asset(Some("sha256:../../etc"))).is_err());
    }

    #[test]
    fn hashes_like_shasum() {
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn carries_over_only_user_files() {
        let root = std::env::temp_dir().join(format!("cs16l-carry-{}", std::process::id()));
        let (old, new) = (root.join("old"), root.join("new"));
        fs::create_dir_all(old.join("cstrike/maps")).unwrap();
        fs::create_dir_all(new.join("cstrike")).unwrap();
        fs::write(old.join("cstrike/config.cfg"), "name \"me\"").unwrap();
        fs::write(old.join("cstrike/maps/fy_pool_day.bsp"), "map").unwrap();
        fs::write(old.join("cstrike/extras.pk3"), "old").unwrap();
        fs::write(new.join("cstrike/extras.pk3"), "new").unwrap();

        carry_over_user_files(&old, &new).unwrap();
        assert_eq!(fs::read_to_string(new.join("cstrike/config.cfg")).unwrap(), "name \"me\"");
        assert!(new.join("cstrike/maps/fy_pool_day.bsp").is_file());
        assert_eq!(fs::read_to_string(new.join("cstrike/extras.pk3")).unwrap(), "new");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn rollback_swaps_and_keeps_latest_config() {
        let root = std::env::temp_dir().join(format!("cs16l-swap-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let manifest = |commit: &str| InstallManifest {
            engine_commit: commit.into(),
            engine_published_at: String::new(),
            client_published_at: String::new(),
            installed_at: 0,
        };
        for (dir, commit) in [(OFFICIAL, "new1234"), (PREVIOUS, "old1234")] {
            fs::create_dir_all(root.join(dir).join("cstrike")).unwrap();
            fs::write(root.join(dir).join(MANIFEST), serde_json::to_vec(&manifest(commit)).unwrap()).unwrap();
            fs::write(root.join(dir).join("cstrike/config.cfg"), format!("name \"{commit}\"")).unwrap();
        }
        fs::write(root.join(OFFICIAL).join("cstrike/history_servers.lst"), "1.2.3.4:27015 48\n").unwrap();

        swap_with_previous(&root).unwrap();
        assert_eq!(read_manifest(&root.join(OFFICIAL)).unwrap().engine_commit, "old1234");
        assert_eq!(read_manifest(&root.join(PREVIOUS)).unwrap().engine_commit, "new1234");
        // The player's latest config and history came along to the older version.
        assert_eq!(fs::read_to_string(root.join(OFFICIAL).join("cstrike/config.cfg")).unwrap(), "name \"new1234\"");
        assert!(root.join(OFFICIAL).join("cstrike/history_servers.lst").is_file());

        swap_with_previous(&root).unwrap(); // undo
        assert_eq!(read_manifest(&root.join(OFFICIAL)).unwrap().engine_commit, "new1234");

        fs::remove_dir_all(root.join(PREVIOUS)).unwrap();
        assert!(swap_with_previous(&root).is_err(), "nothing to roll back to");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn rejects_paths_outside_installs() {
        let base = Path::new("/data/installs");
        assert!(is_plain_child(base, Path::new("/data/installs/oficial")));
        assert!(!is_plain_child(base, Path::new("/data/installs/../escape")));
        assert!(!is_plain_child(base, Path::new("/elsewhere")));
    }

    /// Real download + SHA-256 check + install against GitHub, inside a mock
    /// Tauri app: `cargo test real_install -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_install() {
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let result = tauri::async_runtime::block_on(install_official(&handle)).expect("install");
        println!("{result:?}");
        let dir = Path::new(&result.game_dir);
        let status = crate::game::check(dir, None);
        assert!(status.engine && status.executable && status.client);
        assert_eq!(official(&handle).unwrap().manifest, result.manifest);
        // Second run: swaps in a fresh copy and keeps the previous one.
        fs::write(dir.join("cstrike/config.cfg"), "name \"keepme\"\n").unwrap();
        let again = tauri::async_runtime::block_on(install_official(&handle)).expect("reinstall");
        let new_dir = Path::new(&again.game_dir);
        assert_eq!(fs::read_to_string(new_dir.join("cstrike/config.cfg")).unwrap(), "name \"keepme\"\n");
        assert!(new_dir.parent().unwrap().join("oficial.anterior").is_dir());
        // The mock app has no identifier, so this is a test-only folder.
        fs::remove_dir_all(new_dir.parent().unwrap()).unwrap();
    }

    /// Real end-to-end extraction of the official packages already downloaded
    /// by hand: `cargo test extract_official -- --ignored`.
    #[test]
    #[ignore]
    fn extract_official_packages() {
        let dir = std::env::var("DEAGLE_PKG_DIR").expect("DEAGLE_PKG_DIR");
        let dest = std::env::temp_dir().join(format!("cs16l-extract-{}", std::process::id()));
        fs::create_dir_all(&dest).unwrap();
        extract_tar_xz(&fs::read(Path::new(&dir).join(ENGINE_ASSET)).unwrap(), &dest).unwrap();
        extract_zip(&fs::read(Path::new(&dir).join(CLIENT_ASSET)).unwrap(), &dest).unwrap();
        finish_install(&dest).unwrap();
        let status = crate::game::check(&dest, None);
        println!("engine={} exec={} client={} dir={}", status.engine, status.executable, status.client, dest.display());
        assert!(status.engine && status.executable && status.client);
        assert!(dest.join("SDL2.framework/SDL2").exists());
    }
}
