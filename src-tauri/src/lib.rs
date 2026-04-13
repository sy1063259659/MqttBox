mod agent;
mod app_state;
mod commands;
mod error;
mod models;
mod mqtt;
mod parser;
mod storage;

use app_state::SharedState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let shared_state = SharedState::new(app.handle())?;
            app.manage(shared_state);
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_connections,
            commands::list_connection_folders,
            commands::get_connection_secret,
            commands::create_connection,
            commands::update_connection,
            commands::create_connection_folder,
            commands::update_connection_folder,
            commands::delete_connection_folder,
            commands::reorder_connection_folders,
            commands::reorder_connections,
            commands::test_connection,
            commands::connect_broker,
            commands::disconnect_broker,
            commands::remove_connection,
            commands::list_subscriptions,
            commands::subscribe_topics,
            commands::unsubscribe_topics,
            commands::set_subscription_enabled,
            commands::publish_message,
            commands::load_message_history,
            commands::clear_message_history,
            commands::export_messages,
            commands::list_message_parsers,
            commands::save_message_parser,
            commands::remove_message_parser,
            commands::test_message_parser,
            commands::get_agent_context,
            commands::list_agent_tools,
            commands::get_app_settings,
            commands::save_app_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
