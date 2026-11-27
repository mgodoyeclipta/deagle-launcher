//! Starting the engine and reporting back when it exits.

use crate::game;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

/// Number of log lines sent to the UI when the game exits.
const LOG_TAIL_LINES: usize = 80;
const MAX_PLAYERS: u32 = 32;

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum WindowMode {
    Windowed,
    Fullscreen,
    Borderless,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LaunchAction {
    /// Open the game on its main menu.
    Menu,
    /// Join a server.
    Connect { address: String },
    /// Local listen server with YaPB bots.
    Bots { map: String, count: u32 },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOptions {
    pub game_dir: String,
    pub window_mode: WindowMode,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// SDL display index; only passed if the engine supports `-display`.
    pub display: Option<u32>,
    pub action: LaunchAction,
    pub extra_args: Option<String>,
    pub player_name: Option<String>,
    /// Read-only folder with `valve/` and `cstrike/` (Steam's copy), via `-rodir`.
    #[serde(default)]
    pub data_dir: Option<String>,
    /// HUD scale written as `hud_scale` before launching (2 on Retina screens,
    /// where the engine renders at physical resolution and the HUD looks tiny).
    #[serde(default)]
    pub hud_scale: Option<f32>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameExited {
    pub code: Option<i32>,
    pub success: bool,
    pub log: Vec<String>,
    pub log_path: String,
}

#[derive(Default)]
pub struct GameState {
    running: Mutex<bool>,
}

impl GameState {
    pub fn is_running(&self) -> bool {
        *self.running.lock().unwrap()
    }
}

/// Builds the engine command line. Kept separate from spawning so it can be
/// unit-tested and so every user-provided value is validated in one place.
pub fn build_args(opts: &LaunchOptions, supports_display: bool) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = vec!["-game".into(), "cstrike".into()];

    if let Some(data) = &opts.data_dir {
        if !crate::steam::is_data_dir(Path::new(data)) {
            return Err("La carpeta de datos de Steam no tiene valve/ y cstrike/".into());
        }
        args.extend(["-rodir".into(), data.clone()]);
    }

    args.push(
        match opts.window_mode {
            WindowMode::Windowed => "-windowed",
            WindowMode::Fullscreen => "-fullscreen",
            WindowMode::Borderless => "-borderless",
        }
        .into(),
    );

    if let (Some(w), Some(h)) = (opts.width, opts.height) {
        args.extend(["-width".into(), w.to_string(), "-height".into(), h.to_string()]);
    }

    if let (Some(display), true) = (opts.display, supports_display) {
        args.extend(["-display".into(), display.to_string()]);
    }

    if let Some(extra) = &opts.extra_args {
        args.extend(extra.split_whitespace().map(String::from));
    }

    // `+cmd` arguments go last: the engine runs them as console commands
    // after it has finished parsing its own flags and exec'ing config.cfg.
    match &opts.action {
        LaunchAction::Menu => {}
        LaunchAction::Connect { address } => {
            if !game::is_valid_address(address) {
                return Err(format!("Dirección de servidor inválida: {address}"));
            }
            args.extend(["+connect".into(), address.clone()]);
        }
        LaunchAction::Bots { map, count } => {
            if !game::is_valid_map(map) {
                return Err(format!("Mapa inválido: {map}"));
            }
            let count = (*count).clamp(1, MAX_PLAYERS - 1);
            // Same loader the official cs16-client Android launcher uses.
            args.extend(["-dll".into(), "@yapb".into()]);
            args.extend(["+maxplayers".into(), (count + 1).to_string()]);
            args.extend(["+map".into(), map.clone()]);
            args.extend(["+yb_quota".into(), count.to_string()]);
        }
    }

    Ok(args)
}

pub fn launch(app: &AppHandle, opts: LaunchOptions) -> Result<(), String> {
    let state = app.state::<GameState>();
    {
        let mut running = state.running.lock().unwrap();
        if *running {
            return Err("El juego ya está abierto".into());
        }
        *running = true;
    }

    match spawn(app, opts) {
        Ok(()) => Ok(()),
        Err(e) => {
            *state.running.lock().unwrap() = false;
            Err(e)
        }
    }
}

fn spawn(app: &AppHandle, opts: LaunchOptions) -> Result<(), String> {
    let dir = PathBuf::from(&opts.game_dir);
    let data_dir = opts.data_dir.as_deref().map(Path::new);
    let status = game::check(&dir, data_dir);
    if !status.ok {
        return Err("La carpeta del juego no está lista. Revisala en Ajustes.".into());
    }

    if let Some(name) = &opts.player_name {
        game::seed_config(&dir, data_dir)?;
        game::write_name(&dir, name)?;
    }

    if let Some(scale) = opts.hud_scale {
        if !(0.0..=4.0).contains(&scale) {
            return Err(format!("Escala de HUD inválida: {scale}"));
        }
        game::seed_config(&dir, data_dir)?;
        game::write_cvars(&dir, &[("hud_scale", format!("{scale}"))])?;
    }

    let args = build_args(&opts, status.supports_display)?;

    // Output goes to a file, not a pipe: if the launcher is closed while the
    // game runs, a pipe would break and the engine would die on its next print.
    let log_path = log_file_path(app)?;
    let log = File::create(&log_path).map_err(|e| e.to_string())?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;

    let mut child = Command::new(game::engine_path(&dir))
        .args(&args)
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .spawn()
        .map_err(|e| format!("No se pudo iniciar xash3d: {e}"))?;

    let app = app.clone();
    thread::spawn(move || {
        let exit = child.wait();
        let (code, success) = match &exit {
            Ok(s) => (s.code(), s.success()),
            Err(_) => (None, false),
        };
        *app.state::<GameState>().running.lock().unwrap() = false;
        let _ = app.emit(
            "game-exited",
            GameExited {
                code,
                success,
                log: tail(&log_path, LOG_TAIL_LINES),
                log_path: log_path.display().to_string(),
            },
        );
    });

    Ok(())
}

fn log_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("game.log"))
}

fn tail(path: &Path, lines: usize) -> Vec<String> {
    let bytes = fs::read(path).unwrap_or_default();
    let text = String::from_utf8_lossy(&bytes);
    let all: Vec<&str> = text.lines().collect();
    all[all.len().saturating_sub(lines)..].iter().map(|s| s.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(action: LaunchAction) -> LaunchOptions {
        LaunchOptions {
            game_dir: "/tmp".into(),
            window_mode: WindowMode::Borderless,
            width: None,
            height: None,
            display: Some(1),
            action,
            extra_args: None,
            player_name: None,
            data_dir: None,
            hud_scale: None,
        }
    }

    #[test]
    fn menu_args() {
        let args = build_args(&opts(LaunchAction::Menu), false).unwrap();
        assert_eq!(args, ["-game", "cstrike", "-borderless"]);
    }

    #[test]
    fn display_only_when_supported() {
        let args = build_args(&opts(LaunchAction::Menu), true).unwrap();
        assert_eq!(args, ["-game", "cstrike", "-borderless", "-display", "1"]);
    }

    #[test]
    fn connect_args_and_validation() {
        let ok = build_args(&opts(LaunchAction::Connect { address: "1.2.3.4:27015".into() }), false).unwrap();
        assert_eq!(&ok[3..], ["+connect", "1.2.3.4:27015"]);
        assert!(build_args(&opts(LaunchAction::Connect { address: "1.2.3.4;quit".into() }), false).is_err());
    }

    #[test]
    fn rodir_requires_real_data_folder() {
        let mut o = opts(LaunchAction::Menu);
        o.data_dir = Some("/definitely/not/here".into());
        assert!(build_args(&o, false).is_err());

        let data = std::env::temp_dir().join(format!("cs16l-rodir-{}", std::process::id()));
        std::fs::create_dir_all(data.join("valve")).unwrap();
        std::fs::create_dir_all(data.join("cstrike")).unwrap();
        o.data_dir = Some(data.display().to_string());
        let args = build_args(&o, false).unwrap();
        assert_eq!(&args[..4], ["-game", "cstrike", "-rodir", data.to_str().unwrap()]);
        std::fs::remove_dir_all(&data).unwrap();
    }

    #[test]
    fn bots_args() {
        let args = build_args(&opts(LaunchAction::Bots { map: "de_dust2".into(), count: 9 }), false).unwrap();
        assert_eq!(
            &args[3..],
            ["-dll", "@yapb", "+maxplayers", "10", "+map", "de_dust2", "+yb_quota", "9"]
        );
    }
}
