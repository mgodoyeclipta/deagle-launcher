//! Everything the launcher needs to know about a Xash3D + cs16-client install.
//!
//! The launcher never ships game files: the user points it at their own
//! Xash3D folder (engine + Steam `valve/` and `cstrike/`), and these helpers
//! inspect and lightly maintain that folder.

use serde::Serialize;
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

pub fn check(dir: &Path) -> GameDirStatus {
    let engine = engine_path(dir);
    let has_engine = engine.is_file();
    let executable = has_engine
        && fs::metadata(&engine)
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
    let quarantined = has_engine && has_quarantine(&engine);
    let valve = dir.join("valve").is_dir();
    let cstrike = dir.join("cstrike").is_dir();
    let client = any_file(&dir.join("cstrike/cl_dlls"), &["client_arm64.dylib", "client.dylib"]);
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
// Player name (cstrike/config.cfg)
// ---------------------------------------------------------------------------

fn config_path(dir: &Path) -> PathBuf {
    dir.join("cstrike/config.cfg")
}

/// Reads the `name "..."` cvar the game saved in `config.cfg`.
pub fn read_name(dir: &Path) -> Option<String> {
    let text = fs::read_to_string(config_path(dir)).ok()?;
    text.lines().find_map(parse_name_line)
}

fn parse_name_line(line: &str) -> Option<String> {
    let rest = line.trim_start().strip_prefix("name")?;
    let rest = rest.trim_start().strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
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

/// Writes the player name into `config.cfg` (the game execs it at startup).
/// Only call this while the game is not running: it rewrites the file on exit.
pub fn write_name(dir: &Path, name: &str) -> Result<(), String> {
    let name = sanitize_name(name);
    if name.is_empty() {
        return Ok(());
    }
    let path = config_path(dir);
    let text = fs::read_to_string(&path).unwrap_or_default();
    let new_line = format!("name \"{name}\"");

    let mut replaced = false;
    let mut lines: Vec<String> = text
        .lines()
        .map(|line| {
            if !replaced && parse_name_line(line).is_some() {
                replaced = true;
                new_line.clone()
            } else {
                line.to_string()
            }
        })
        .collect();
    if !replaced {
        lines.push(new_line);
    }

    let mut out = lines.join("\n");
    out.push('\n');
    fs::write(&path, out).map_err(|e| e.to_string())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_name_line() {
        assert_eq!(parse_name_line("name \"matiGOD\""), Some("matiGOD".into()));
        assert_eq!(parse_name_line("  name   \"a b\""), Some("a b".into()));
        assert_eq!(parse_name_line("name_tag \"x\""), None);
        assert_eq!(parse_name_line("hud_color \"255 0 0\""), None);
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
