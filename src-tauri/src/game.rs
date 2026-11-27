//! Everything the launcher needs to know about a Xash3D + cs16-client install.
//!
//! The launcher never ships game files: the user points it at their own
//! Xash3D folder (engine + Steam `valve/` and `cstrike/`), and these helpers
//! inspect and lightly maintain that folder.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

const ENGINE_BIN: &str = "xash3d";
const ENGINE_LIB: &str = "libxash.dylib";
const QUARANTINE_ATTR: &str = "com.apple.quarantine";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDirStatus {
    /// `xash3d` binary is present.
    pub engine: bool,
    /// `xash3d` has the executable bit set.
    pub executable: bool,
    /// macOS Gatekeeper quarantine flag is set on the engine.
    pub quarantined: bool,
    /// Steam `valve/` folder is present.
    pub valve: bool,
    /// Steam `cstrike/` folder is present.
    pub cstrike: bool,
    /// cs16-client is installed into `cstrike/cl_dlls`.
    pub client: bool,
    /// YaPB bots are installed into `cstrike/dlls`.
    pub bots: bool,
    /// Engine understands `-display <n>` (needs the patched engine).
    pub supports_display: bool,
    /// Everything required to launch is in place.
    pub ok: bool,
}

pub fn engine_path(dir: &Path) -> PathBuf {
    dir.join(ENGINE_BIN)
}

/// `data_dir` is an optional read-only folder with `valve/` and `cstrike/`
/// (Steam's copy), used through the engine's `-rodir`.
pub fn check(dir: &Path, data_dir: Option<&Path>) -> GameDirStatus {
    let shared_data = data_dir.is_some_and(crate::steam::is_data_dir);
    let engine = engine_path(dir);
    let has_engine = engine.is_file();
    let executable = has_engine
        && fs::metadata(&engine)
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
    let quarantined = has_engine && has_quarantine(&engine);
    let valve = dir.join("valve").is_dir() || shared_data;
    let cstrike = dir.join("cstrike").is_dir() || shared_data;
    // cs16-client = its libraries plus its resource pack (menu, HUD); without
    // extras.pk3 the game shows the wrong menu and crashes.
    let client = any_file(&dir.join("cstrike/cl_dlls"), &["client_arm64.dylib", "client.dylib"])
        && dir.join("cstrike/extras.pk3").is_file();
    let bots = any_file(&dir.join("cstrike/dlls"), &["yapb_arm64.dylib", "yapb.dylib"]);
    let supports_display = file_contains(&dir.join(ENGINE_LIB), b"-display");

    GameDirStatus {
        engine: has_engine,
        executable,
        quarantined,
        valve,
        cstrike,
        client,
        bots,
        supports_display,
        ok: has_engine && executable && !quarantined && valve && cstrike && client,
    }
}

/// Makes the engine executable and clears the Gatekeeper quarantine flag
/// from the whole folder (engine, dylibs, cs16-client libraries).
pub fn fix(dir: &Path) -> Result<(), String> {
    let engine = engine_path(dir);
    if !engine.is_file() {
        return Err("No se encontró xash3d en esa carpeta".into());
    }

    let mut perms = fs::metadata(&engine).map_err(|e| e.to_string())?.permissions();
    perms.set_mode(perms.mode() | 0o755);
    fs::set_permissions(&engine, perms).map_err(|e| e.to_string())?;

    let status = Command::new("/usr/bin/xattr")
        .args(["-dr", QUARANTINE_ATTR])
        .arg(dir)
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("No se pudo quitar la cuarentena de macOS".into());
    }
    Ok(())
}

fn has_quarantine(path: &Path) -> bool {
    Command::new("/usr/bin/xattr")
        .args(["-p", QUARANTINE_ATTR])
        .arg(path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn any_file(dir: &Path, names: &[&str]) -> bool {
    names.iter().any(|n| dir.join(n).is_file())
}

fn file_contains(path: &Path, needle: &[u8]) -> bool {
    fs::read(path)
        .map(|data| data.windows(needle.len()).any(|w| w == needle))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Cvars in cstrike/config.cfg (player name, crosshair, HUD colour)
// ---------------------------------------------------------------------------

fn config_path(dir: &Path) -> PathBuf {
    dir.join("cstrike/config.cfg")
}

/// Value of `name "value"` if this config line sets the cvar `name`.
fn parse_cvar_line(line: &str, name: &str) -> Option<String> {
    let rest = line.trim_start().strip_prefix(name)?;
    if !rest.starts_with(char::is_whitespace) {
        return None; // e.g. `name_tag` when looking for `name`
    }
    let rest = rest.trim_start().strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// Reads the given cvars from `config.cfg`; missing ones are left out.
pub fn read_cvars(dir: &Path, names: &[&str]) -> HashMap<String, String> {
    let text = fs::read_to_string(config_path(dir)).unwrap_or_default();
    let mut out = HashMap::new();
    for line in text.lines() {
        for name in names {
            if !out.contains_key(*name) {
                if let Some(value) = parse_cvar_line(line, name) {
                    out.insert(name.to_string(), value);
                }
            }
        }
    }
    out
}

/// Sets cvars in `config.cfg`, replacing their existing lines and appending
/// new ones. The game execs this file at startup and rewrites it on exit, so
/// only call this while the game is not running. Values must already be safe.
pub fn write_cvars(dir: &Path, values: &[(&str, String)]) -> Result<(), String> {
    let path = config_path(dir);
    let text = fs::read_to_string(&path).unwrap_or_default();
    if path.is_file() {
        // Safety net for every edit the launcher makes to the user's config.
        fs::copy(&path, dir.join("cstrike/config.cfg.deagle.bak")).map_err(|e| e.to_string())?;
    }
    let mut pending: Vec<&(&str, String)> = values.iter().collect();

    let mut lines: Vec<String> = text
        .lines()
        .map(|line| {
            if let Some(i) = pending.iter().position(|(name, _)| parse_cvar_line(line, name).is_some()) {
                let (name, value) = pending.remove(i);
                format!("{name} \"{value}\"")
            } else {
                line.to_string()
            }
        })
        .collect();
    lines.extend(pending.iter().map(|(name, value)| format!("{name} \"{value}\"")));

    let mut out = lines.join("\n");
    out.push('\n');
    fs::write(&path, out).map_err(|e| e.to_string())
}

/// The config to read from: the install's own, or the shared data folder's
/// until the game has written one locally.
pub fn config_base<'a>(dir: &'a Path, data_dir: Option<&'a Path>) -> &'a Path {
    match data_dir {
        Some(data) if !config_path(dir).is_file() && config_path(data).is_file() => data,
        _ => dir,
    }
}

/// Before the first edit of an install that reads its data from elsewhere,
/// start from that data folder's config.cfg instead of an empty file
/// (an almost empty config.cfg would wipe the player's key bindings).
pub fn seed_config(dir: &Path, data_dir: Option<&Path>) -> Result<(), String> {
    let base = config_base(dir, data_dir);
    if base != dir {
        fs::create_dir_all(dir.join("cstrike")).map_err(|e| e.to_string())?;
        fs::copy(config_path(base), config_path(dir)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Reads the `name "..."` cvar the game saved in `config.cfg`.
pub fn read_name(dir: &Path) -> Option<String> {
    read_cvars(dir, &["name"]).remove("name")
}

/// Strips characters that would break out of the quoted cvar value or
/// inject extra console commands, and applies the engine's length limit.
pub fn sanitize_name(name: &str) -> String {
    name.chars()
        .filter(|c| !matches!(c, '"' | ';' | '\\') && !c.is_control())
        .take(31)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Writes the player name into `config.cfg`.
pub fn write_name(dir: &Path, name: &str) -> Result<(), String> {
    let name = sanitize_name(name);
    if name.is_empty() {
        return Ok(());
    }
    write_cvars(dir, &[("name", name)])
}

/// Crosshair (cs16-client enhanced and classic) and HUD colour cvars the
/// launcher's crosshair editor may read and write. Nothing else is touched.
pub const CROSSHAIR_CVARS: &[&str] = &[
    "xhair_enable",
    "xhair_color",
    "xhair_size",
    "xhair_gap",
    "xhair_thick",
    "xhair_pad",
    "xhair_dot",
    "xhair_t",
    "xhair_additive",
    "xhair_dynamic_scale",
    "xhair_gap_useweaponvalue",
    "xhair_dynamic_move",
    "cl_crosshair_color",
    "cl_crosshair_size",
    "cl_crosshair_translucent",
    "cl_dynamiccrosshair",
    "hud_color",
];

/// Numbers (`-2`, `0.5`, `0 255 0 255`) or a single lowercase word
/// (`auto`, `small`): nothing that could close the quotes or chain commands.
pub fn is_safe_cvar_value(value: &str) -> bool {
    let numeric = value.chars().all(|c| c.is_ascii_digit() || matches!(c, ' ' | '.' | '-'));
    let word = value.chars().all(|c| c.is_ascii_lowercase());
    !value.is_empty() && value.len() <= 32 && (numeric || word)
}

/// Validates and writes crosshair/HUD cvars.
pub fn write_crosshair(dir: &Path, values: &HashMap<String, String>) -> Result<(), String> {
    let mut checked: Vec<(&str, String)> = Vec::new();
    for (name, value) in values {
        let known = CROSSHAIR_CVARS
            .iter()
            .find(|n| *n == name)
            .ok_or_else(|| format!("Variable no permitida: {name}"))?;
        let value = value.trim();
        if !is_safe_cvar_value(value) {
            return Err(format!("Valor inválido para {name}: {value}"));
        }
        checked.push((known, value.to_string()));
    }
    checked.sort_by_key(|(name, _)| *name); // stable output for appended lines
    write_cvars(dir, &checked)
}

// ---------------------------------------------------------------------------
// Servers and maps
// ---------------------------------------------------------------------------

/// Servers from the in-game history (`cstrike/history_servers.lst`), most
/// recently added first. Each line is `address protocol`.
pub fn recent_servers(dir: &Path) -> Vec<String> {
    let Ok(text) = fs::read_to_string(dir.join("cstrike/history_servers.lst")) else {
        return Vec::new();
    };
    let mut servers: Vec<String> = Vec::new();
    for addr in text.lines().rev().filter_map(|l| l.split_whitespace().next()) {
        if is_valid_address(addr) && !servers.iter().any(|s| s == addr) {
            servers.push(addr.to_string());
        }
    }
    servers
}

/// Playable multiplayer maps in `cstrike/maps` (de_, cs_ and as_ maps).
pub fn list_maps(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir.join("cstrike/maps")) else {
        return Vec::new();
    };
    let mut maps: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            if path.extension()? != "bsp" {
                return None;
            }
            let stem = path.file_stem()?.to_str()?.to_string();
            let playable = ["de_", "cs_", "as_"].iter().any(|p| stem.starts_with(p));
            (playable && is_valid_map(&stem)).then_some(stem)
        })
        .collect();
    maps.sort();
    maps
}

/// `host`, `host:port`, IPv4 — no spaces or `;` that could inject commands.
pub fn is_valid_address(addr: &str) -> bool {
    !addr.is_empty()
        && addr.len() <= 255
        && addr.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '-'))
}

pub fn is_valid_map(map: &str) -> bool {
    !map.is_empty()
        && map.len() <= 64
        && map.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
}

// ---------------------------------------------------------------------------
// Installed versions (for the update checker)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineVersion {
    pub build: u32,
    pub commit: String,
    pub branch: String,
    pub platform: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledVersions {
    /// From the header the engine writes into its .cfg files.
    pub engine: Option<EngineVersion>,
    /// Unix seconds when cs16-client's library was built / installed.
    pub client_built_at: Option<u64>,
}

/// Parses `Generated by Xash3D FWGS (4045, 7d87d65, master, apple-arm64)`.
fn parse_engine_header(text: &str) -> Option<EngineVersion> {
    let start = text.find("Generated by Xash3D FWGS (")? + "Generated by Xash3D FWGS (".len();
    let end = start + text[start..].find(')')?;
    let parts: Vec<&str> = text[start..end].split(',').map(str::trim).collect();
    let [build, commit, branch, platform] = parts.as_slice() else {
        return None;
    };
    if !commit.chars().all(|c| c.is_ascii_hexdigit()) || commit.len() < 7 {
        return None;
    }
    Some(EngineVersion {
        build: build.parse().ok()?,
        commit: commit.to_string(),
        branch: branch.to_string(),
        platform: platform.to_string(),
    })
}

fn modified_secs(path: &Path) -> Option<u64> {
    let time = fs::metadata(path).ok()?.modified().ok()?;
    Some(time.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs())
}

pub fn installed_versions(dir: &Path) -> InstalledVersions {
    let engine = ["cstrike/video.cfg", "cstrike/config.cfg", "cstrike/opengl.cfg", "valve/config.cfg"]
        .iter()
        .filter_map(|f| fs::read(dir.join(f)).ok())
        .find_map(|bytes| parse_engine_header(&String::from_utf8_lossy(&bytes)));
    let client_built_at = ["client_arm64.dylib", "client.dylib"]
        .iter()
        .find_map(|f| modified_secs(&dir.join("cstrike/cl_dlls").join(f)));
    InstalledVersions { engine, client_built_at }
}

// ---------------------------------------------------------------------------
// UI sound effects
// ---------------------------------------------------------------------------

/// Sound effects the launcher can play. They are read from the user's own game
/// install at runtime and never shipped with the launcher (they belong to
/// Valve). Only these fixed paths can be read: no arbitrary file access.
pub fn sound_file(name: &str) -> Option<&'static str> {
    Some(match name {
        "click" => "valve/sound/common/launch_select2.wav",
        "open" => "valve/sound/common/launch_upmenu1.wav",
        "close" => "valve/sound/common/launch_dnmenu1.wav",
        "select" => "valve/sound/common/wpn_moveselect.wav",
        "deny" => "valve/sound/common/wpn_denyselect.wav",
        "connect" => "cstrike/sound/weapons/deagle-2.wav",
        "bots" => "cstrike/sound/radio/locknload.wav",
        "launch" => "cstrike/sound/radio/letsgo.wav",
        "shuffle" => "cstrike/sound/weapons/de_clipin.wav",
        _ => return None,
    })
}

/// Sound files are a few KB; anything bigger is not what we expect.
const MAX_SOUND_BYTES: u64 = 2 * 1024 * 1024;

pub fn read_sound(dir: &Path, name: &str) -> Result<Vec<u8>, String> {
    let rel = sound_file(name).ok_or_else(|| format!("Sonido desconocido: {name}"))?;
    let path = dir.join(rel);
    let len = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if len > MAX_SOUND_BYTES {
        return Err(format!("Archivo de sonido demasiado grande: {rel}"));
    }
    fs::read(&path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_needs_its_resource_pack() {
        let dir = std::env::temp_dir().join(format!("cs16l-client-{}", std::process::id()));
        fs::create_dir_all(dir.join("cstrike/cl_dlls")).unwrap();
        fs::write(dir.join("cstrike/cl_dlls/client_arm64.dylib"), b"x").unwrap();
        assert!(!check(&dir, None).client, "binaries alone are not enough");
        fs::write(dir.join("cstrike/extras.pk3"), b"x").unwrap();
        assert!(check(&dir, None).client);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn parses_cvar_lines() {
        assert_eq!(parse_cvar_line("name \"matiGOD\"", "name"), Some("matiGOD".into()));
        assert_eq!(parse_cvar_line("  name   \"a b\"", "name"), Some("a b".into()));
        assert_eq!(parse_cvar_line("name_tag \"x\"", "name"), None);
        assert_eq!(parse_cvar_line("hud_color \"255 0 0\"", "name"), None);
        assert_eq!(parse_cvar_line("xhair_gap \"-2\"", "xhair_gap"), Some("-2".into()));
        assert_eq!(parse_cvar_line("xhair_gap_useweaponvalue \"0\"", "xhair_gap"), None);
    }

    #[test]
    fn validates_cvar_values() {
        assert!(is_safe_cvar_value("0 255 0 255"));
        assert!(is_safe_cvar_value("-2"));
        assert!(is_safe_cvar_value("0.5"));
        assert!(is_safe_cvar_value("small"));
        assert!(!is_safe_cvar_value("1\"; quit"));
        assert!(!is_safe_cvar_value("Small"));
        assert!(!is_safe_cvar_value(""));
    }

    #[test]
    fn seeds_config_from_shared_data() {
        let root = std::env::temp_dir().join(format!("cs16l-seed-{}", std::process::id()));
        let (install, data) = (root.join("install"), root.join("steam"));
        fs::create_dir_all(data.join("cstrike")).unwrap();
        fs::create_dir_all(data.join("valve")).unwrap();
        fs::write(config_path(&data), "bind \"w\" \"+forward\"\nname \"Player\"\n").unwrap();

        assert_eq!(config_base(&install, Some(&data)), data.as_path());
        assert_eq!(read_name(config_base(&install, Some(&data))), Some("Player".into()));
        seed_config(&install, Some(&data)).unwrap();
        write_name(&install, "matiGOD").unwrap();
        let text = fs::read_to_string(config_path(&install)).unwrap();
        assert_eq!(text, "bind \"w\" \"+forward\"\nname \"matiGOD\"\n");
        assert_eq!(fs::read_to_string(config_path(&data)).unwrap(), "bind \"w\" \"+forward\"\nname \"Player\"\n");
        assert_eq!(config_base(&install, Some(&data)), install.as_path());

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn writes_crosshair_cvars_safely() {
        let dir = std::env::temp_dir().join(format!("cs16l-xhair-{}", std::process::id()));
        fs::create_dir_all(dir.join("cstrike")).unwrap();
        fs::write(config_path(&dir), "bind \"w\" \"+forward\"\nxhair_gap \"-2\"\nxhair_gap_useweaponvalue \"0\"\n").unwrap();

        let mut values = HashMap::new();
        values.insert("xhair_gap".to_string(), "3".to_string());
        values.insert("xhair_color".to_string(), "255 0 0 200".to_string());
        write_crosshair(&dir, &values).unwrap();
        let text = fs::read_to_string(config_path(&dir)).unwrap();
        assert_eq!(
            text,
            "bind \"w\" \"+forward\"\nxhair_gap \"3\"\nxhair_gap_useweaponvalue \"0\"\nxhair_color \"255 0 0 200\"\n"
        );
        let backup = fs::read_to_string(dir.join("cstrike/config.cfg.deagle.bak")).unwrap();
        assert!(backup.contains("xhair_gap \"-2\""), "backup keeps the previous config");
        let read = read_cvars(&dir, CROSSHAIR_CVARS);
        assert_eq!(read.get("xhair_gap").map(String::as_str), Some("3"));

        let mut bad = HashMap::new();
        bad.insert("rcon_password".to_string(), "1".to_string());
        assert!(write_crosshair(&dir, &bad).is_err());
        let mut injection = HashMap::new();
        injection.insert("xhair_gap".to_string(), "1\"; quit".to_string());
        assert!(write_crosshair(&dir, &injection).is_err());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sanitizes_name() {
        assert_eq!(sanitize_name("  mati\"; quit  "), "mati quit");
        assert_eq!(sanitize_name(&"x".repeat(40)).len(), 31);
    }

    #[test]
    fn validates_addresses_and_maps() {
        assert!(is_valid_address("186.19.63.56:27015"));
        assert!(is_valid_address("cs.example.com:27015"));
        assert!(!is_valid_address("1.2.3.4;quit"));
        assert!(!is_valid_address("1.2.3.4 27015"));
        assert!(is_valid_map("de_dust2"));
        assert!(!is_valid_map("de_dust2;quit"));
    }

    #[test]
    fn parses_engine_header() {
        let cfg = "//====\n//\tGenerated by Xash3D FWGS (4045, 7d87d65, master, apple-arm64)\n";
        assert_eq!(
            parse_engine_header(cfg),
            Some(EngineVersion {
                build: 4045,
                commit: "7d87d65".into(),
                branch: "master".into(),
                platform: "apple-arm64".into(),
            })
        );
        assert_eq!(parse_engine_header("// This file is overwritten whenever you change your user settings"), None);
        assert_eq!(parse_engine_header("Generated by Xash3D FWGS (x, zzzzzzz, a, b)"), None);
    }

    #[test]
    fn only_known_sounds_are_readable() {
        assert!(sound_file("click").is_some());
        assert!(sound_file("../../etc/passwd").is_none());
        assert!(read_sound(Path::new("/tmp"), "../secret").is_err());
    }

    #[test]
    fn writes_name_preserving_config() {
        let dir = std::env::temp_dir().join(format!("cs16l-test-{}", std::process::id()));
        fs::create_dir_all(dir.join("cstrike")).unwrap();
        fs::write(config_path(&dir), "bind \"w\" \"+forward\"\nname \"old\"\nsensitivity \"3\"\n").unwrap();

        write_name(&dir, "nuevo").unwrap();
        let text = fs::read_to_string(config_path(&dir)).unwrap();
        assert_eq!(text, "bind \"w\" \"+forward\"\nname \"nuevo\"\nsensitivity \"3\"\n");
        assert_eq!(read_name(&dir), Some("nuevo".into()));

        fs::remove_dir_all(&dir).unwrap();
    }
}
