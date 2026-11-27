//! Finds the user's Steam copy of Counter-Strike (app 10), so the engine can
//! read its data in place with `-rodir` instead of the user copying `valve/`
//! and `cstrike/` around. Read-only: nothing in Steam's folders is modified.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const CS_APP_ID: &str = "10";
/// StateFlags bit 2 (value 4) = "fully installed".
const STATE_FULLY_INSTALLED: u64 = 4;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SteamStatus {
    /// Steam itself is installed.
    pub steam_installed: bool,
    /// Counter-Strike's manifest says it is fully installed.
    pub cs_installed: bool,
    /// Folder holding `valve/` and `cstrike/` (Steam's `common/Half-Life`).
    pub data_dir: Option<String>,
}

fn steam_root() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let root = Path::new(&home).join("Library/Application Support/Steam");
    root.is_dir().then_some(root)
}

/// Value of a `"key"  "value"` line in Valve's KeyValues text format.
fn kv_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let mut parts = line.split('"').filter(|s| !s.trim().is_empty());
    (parts.next()? == key).then_some(())?;
    parts.next()
}

/// Library folders from `steamapps/libraryfolders.vdf`, plus Steam's root.
fn libraries(root: &Path) -> Vec<PathBuf> {
    let mut libs = vec![root.to_path_buf()];
    if let Ok(text) = fs::read_to_string(root.join("steamapps/libraryfolders.vdf")) {
        for line in text.lines() {
            if let Some(path) = kv_value(line, "path") {
                let path = PathBuf::from(path.replace("\\\\", "\\"));
                if !libs.contains(&path) {
                    libs.push(path);
                }
            }
        }
    }
    libs
}

struct Manifest {
    install_dir: String,
    state_flags: u64,
}

fn parse_manifest(text: &str) -> Option<Manifest> {
    let mut install_dir = None;
    let mut state_flags = 0;
    for line in text.lines() {
        if let Some(v) = kv_value(line, "installdir") {
            install_dir = Some(v.to_string());
        } else if let Some(v) = kv_value(line, "StateFlags") {
            state_flags = v.parse().unwrap_or(0);
        }
    }
    Some(Manifest { install_dir: install_dir?, state_flags })
}

fn has_game_data(dir: &Path) -> bool {
    dir.join("valve").is_dir() && dir.join("cstrike").is_dir()
}

pub fn detect() -> SteamStatus {
    let Some(root) = steam_root() else {
        return SteamStatus { steam_installed: false, cs_installed: false, data_dir: None };
    };
    for lib in libraries(&root) {
        let apps = lib.join("steamapps");
        let Ok(text) = fs::read_to_string(apps.join(format!("appmanifest_{CS_APP_ID}.acf"))) else {
            continue;
        };
        let Some(manifest) = parse_manifest(&text) else { continue };
        let dir = apps.join("common").join(&manifest.install_dir);
        let installed = manifest.state_flags & STATE_FULLY_INSTALLED != 0 && has_game_data(&dir);
        return SteamStatus {
            steam_installed: true,
            cs_installed: installed,
            data_dir: installed.then(|| dir.display().to_string()),
        };
    }
    SteamStatus { steam_installed: true, cs_installed: false, data_dir: None }
}

/// Is `dir` a usable read-only data folder (has `valve/` and `cstrike/`)?
pub fn is_data_dir(dir: &Path) -> bool {
    has_game_data(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Inspects the real machine; run with `cargo test steam -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_detect() {
        println!("{:?}", detect());
    }

    #[test]
    fn reads_keyvalues() {
        assert_eq!(kv_value("\t\t\"path\"\t\t\"/Users/x/Steam\"", "path"), Some("/Users/x/Steam"));
        assert_eq!(kv_value("\t\"appid\"\t\t\"10\"", "path"), None);
        assert_eq!(kv_value("{", "path"), None);
    }

    #[test]
    fn parses_cs_manifest() {
        let acf = "\"AppState\"\n{\n\t\"appid\"\t\t\"10\"\n\t\"name\"\t\t\"Counter-Strike\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"Half-Life\"\n}\n";
        let m = parse_manifest(acf).unwrap();
        assert_eq!(m.install_dir, "Half-Life");
        assert_eq!(m.state_flags & STATE_FULLY_INSTALLED, 4);
        let updating = acf.replace("\"4\"", "\"1026\"");
        assert_eq!(parse_manifest(&updating).unwrap().state_flags & STATE_FULLY_INSTALLED, 0);
    }
}
