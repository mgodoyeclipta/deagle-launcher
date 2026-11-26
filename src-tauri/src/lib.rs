mod commands;
mod game;
mod launch;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(launch::GameState::default())
        .invoke_handler(tauri::generate_handler![
            commands::check_game_dir,
            commands::fix_game_dir,
            commands::read_player_name,
            commands::recent_servers,
            commands::list_maps,
            commands::launch_game,
            commands::is_game_running,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
