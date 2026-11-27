//! Tauri commands exposed to the React UI via `invoke()`.

use crate::game::{self, GameDirStatus};
use crate::launch::{self, GameState, LaunchOptions};
use std::path::Path;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn check_game_dir(game_dir: String, data_dir: Option<String>) -> GameDirStatus {
    game::check(Path::new(&game_dir), data_dir.as_deref().map(Path::new))
}

#[tauri::command]
pub fn fix_game_dir(game_dir: String, data_dir: Option<String>) -> Result<GameDirStatus, String> {
    let dir = Path::new(&game_dir);
    game::fix(dir)?;
    Ok(game::check(dir, data_dir.as_deref().map(Path::new)))
}

#[tauri::command]
pub fn read_player_name(game_dir: String, data_dir: Option<String>) -> Option<String> {
    game::read_name(game::config_base(Path::new(&game_dir), data_dir.as_deref().map(Path::new)))
}

#[tauri::command]
pub fn recent_servers(game_dir: String) -> Vec<String> {
    game::recent_servers(Path::new(&game_dir))
}

#[tauri::command]
pub fn list_maps(game_dir: String) -> Vec<String> {
    game::list_maps(Path::new(&game_dir))
}

#[tauri::command]
pub fn launch_game(app: AppHandle, options: LaunchOptions) -> Result<(), String> {
    launch::launch(&app, options)
}

#[tauri::command]
pub fn is_game_running(state: State<'_, GameState>) -> bool {
    state.is_running()
}

/// Raw bytes of one of the launcher's UI sounds (see `game::sound_file`).
#[tauri::command]
pub fn game_sound(game_dir: String, name: String) -> Result<tauri::ipc::Response, String> {
    game::read_sound(Path::new(&game_dir), &name).map(tauri::ipc::Response::new)
}

/// Live A2S info for each address (name, map, players, ping), in input order.
#[tauri::command]
pub async fn query_servers(addresses: Vec<String>) -> Result<Vec<crate::a2s::ServerStatus>, String> {
    if addresses.len() > crate::a2s::MAX_SERVERS {
        return Err(format!("Demasiados servidores (máximo {})", crate::a2s::MAX_SERVERS));
    }
    if let Some(bad) = addresses.iter().find(|a| !game::is_valid_address(a)) {
        return Err(format!("Dirección inválida: {bad}"));
    }
    Ok(crate::a2s::query_many(addresses).await)
}

/// Players currently on a server (name, score, time connected).
#[tauri::command]
pub async fn query_players(address: String) -> Result<Vec<crate::a2s::PlayerInfo>, String> {
    if !game::is_valid_address(&address) {
        return Err(format!("Dirección inválida: {address}"));
    }
    crate::a2s::query_players(&address).await
}

/// Engine build/commit and cs16-client build date of the user's install.
#[tauri::command]
pub fn installed_versions(game_dir: String) -> game::InstalledVersions {
    game::installed_versions(Path::new(&game_dir))
}

/// Whether a Discord application ID is configured in this build.
#[tauri::command]
pub fn discord_available() -> bool {
    crate::discord::is_configured()
}

/// Sets (or, with `None`, clears) the Discord Rich Presence. Runs off the
/// main thread because talking to Discord's IPC socket can block briefly.
#[tauri::command]
pub async fn discord_presence(
    app: AppHandle,
    presence: Option<crate::discord::Presence>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<crate::discord::DiscordState>();
        match presence {
            Some(p) => state.set(&p),
            None => {
                state.clear();
                Ok(())
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Current crosshair and HUD colour cvars from config.cfg.
#[tauri::command]
pub fn read_crosshair(game_dir: String, data_dir: Option<String>) -> std::collections::HashMap<String, String> {
    let base = game::config_base(Path::new(&game_dir), data_dir.as_deref().map(Path::new));
    game::read_cvars(base, game::CROSSHAIR_CVARS)
}

/// Saves crosshair/HUD cvars into config.cfg. Refused while the game runs,
/// because the game rewrites config.cfg when it exits.
#[tauri::command]
pub fn write_crosshair(
    state: State<'_, GameState>,
    game_dir: String,
    data_dir: Option<String>,
    values: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    if state.is_running() {
        return Err("Cerrá el juego para guardar la mira: el juego reescribe su configuración al salir.".into());
    }
    let dir = Path::new(&game_dir);
    game::seed_config(dir, data_dir.as_deref().map(Path::new))?;
    game::write_crosshair(dir, &values)
}

/// Where (and whether) Steam has Counter-Strike installed.
#[tauri::command]
pub fn detect_steam() -> crate::steam::SteamStatus {
    crate::steam::detect()
}
