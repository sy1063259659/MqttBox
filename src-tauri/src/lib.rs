mod agent;
mod agent_service;
mod app_state;
mod commands;
mod error;
mod models;
mod mqtt;
mod parser;
mod storage;

use agent_service::ManagedAgentService;
use app_state::SharedState;
use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let managed_agent_service = Arc::new(Mutex::new(ManagedAgentService::new()));
    let agent_service_for_setup = Arc::clone(&managed_agent_service);
    let agent_service_for_run = Arc::clone(&managed_agent_service);

    let app = tauri::Builder::default()
        .setup(move |app| {
            let shared_state = SharedState::new(app.handle())?;
            app.manage(shared_state);
            if let Ok(mut service) = agent_service_for_setup.lock() {
                if let Err(error) = service.ensure_running(app.handle()) {
                    eprintln!("[agent-service] failed to auto-start local service: {error}");
                }
            }
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
            commands::get_agent_settings,
            commands::save_agent_settings,
            commands::save_app_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            if let Ok(mut service) = agent_service_for_run.lock() {
                service.shutdown();
            }
        }
    });
}
