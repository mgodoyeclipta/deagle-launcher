//! Tauri commands exposed to the React UI via `invoke()`.

use crate::game::{self, GameDirStatus};
use crate::launch::{self, GameState, LaunchOptions};
use std::path::Path;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn check_game_dir(game_dir: String) -> GameDirStatus {
    game::check(Path::new(&game_dir))
}

#[tauri::command]
pub fn fix_game_dir(game_dir: String) -> Result<GameDirStatus, String> {
    let dir = Path::new(&game_dir);
    game::fix(dir)?;
    Ok(game::check(dir))
}

#[tauri::command]
pub fn read_player_name(game_dir: String) -> Option<String> {
    game::read_name(Path::new(&game_dir))
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
