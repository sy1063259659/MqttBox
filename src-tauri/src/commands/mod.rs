use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    agent_service::list_live_agent_tools,
    app_state::SharedState,
    error::AppError,
    models::{
        AgentContextDto, AgentEventPayload, AgentSettingsDto, AgentToolDescriptor, AppSettingsDto,
        ConnectionEventPayload, ConnectionFolderDto, ConnectionProfileDto, ConnectionProfileInput,
        ConnectionReorderItem, ConnectionSecretDto, ConnectionTestResultDto, ExportRequest,
        MessageFilter, MessageHistoryPageDto, MessageParserDto, MessageParserInput,
        MessageParserTestRequest, MessageParserTestResultDto, MessageRecordDto, PublishRequest,
        SubscriptionDto, SubscriptionInput,
    },
    mqtt,
    parser::{build_payload_fields, test_message_parser as run_message_parser_test},
};

#[tauri::command]
pub fn list_connections(
    state: State<'_, SharedState>,
) -> Result<Vec<ConnectionProfileDto>, String> {
    state
        .storage
        .lock()
        .unwrap()
        .list_connections()
        .map_err(to_string)
}

#[tauri::command]
pub fn list_connection_folders(
    state: State<'_, SharedState>,
) -> Result<Vec<ConnectionFolderDto>, String> {
    state
        .storage
        .lock()
        .unwrap()
        .list_connection_folders()
        .map_err(to_string)
}

#[tauri::command]
pub fn get_connection_secret(
    state: State<'_, SharedState>,
    connection_id: String,
) -> Result<Option<ConnectionSecretDto>, String> {
    state
        .storage
        .lock()
        .unwrap()
        .get_connection_secret(&connection_id)
        .map_err(to_string)
}

#[tauri::command]
pub fn create_connection(
    state: State<'_, SharedState>,
    profile: ConnectionProfileInput,
) -> Result<ConnectionProfileDto, String> {
    state
        .storage
        .lock()
        .unwrap()
        .save_connection(profile)
        .map_err(to_string)
}

#[tauri::command]
pub fn update_connection(
    state: State<'_, SharedState>,
    profile: ConnectionProfileInput,
) -> Result<ConnectionProfileDto, String> {
    state
        .storage
        .lock()
        .unwrap()
        .save_connection(profile)
        .map_err(to_string)
}

#[tauri::command]
pub fn create_connection_folder(
    state: State<'_, SharedState>,
    name: String,
) -> Result<ConnectionFolderDto, String> {
    state
        .storage
        .lock()
        .unwrap()
        .create_connection_folder(name)
        .map_err(to_string)
}

#[tauri::command]
pub fn update_connection_folder(
    state: State<'_, SharedState>,
    folder_id: String,
    name: String,
) -> Result<ConnectionFolderDto, String> {
    state
        .storage
        .lock()
        .unwrap()
        .update_connection_folder(&folder_id, name)
        .map_err(to_string)
}

#[tauri::command]
pub fn delete_connection_folder(
    state: State<'_, SharedState>,
    folder_id: String,
) -> Result<(), String> {
    state
        .storage
        .lock()
        .unwrap()
        .delete_connection_folder(&folder_id)
        .map_err(to_string)
}

#[tauri::command]
pub fn reorder_connection_folders(
    state: State<'_, SharedState>,
    folder_ids: Vec<String>,
) -> Result<(), String> {
    state
        .storage
        .lock()
        .unwrap()
        .reorder_connection_folders(folder_ids)
        .map_err(to_string)
}

#[tauri::command]
pub fn reorder_connections(
    state: State<'_, SharedState>,
    items: Vec<ConnectionReorderItem>,
) -> Result<(), String> {
    state
        .storage
        .lock()
        .unwrap()
        .reorder_connections(items)
        .map_err(to_string)
}

#[tauri::command]
pub async fn test_connection(
    profile: ConnectionProfileInput,
) -> Result<ConnectionTestResultDto, String> {
    mqtt::test_connection(&profile).await.map_err(to_string)
}

#[tauri::command]
pub async fn connect_broker(
    app: AppHandle,
    state: State<'_, SharedState>,
    connection_id: String,
) -> Result<(), String> {
    state
        .mqtt
        .lock()
        .unwrap()
        .clear_manual_disconnect(&connection_id);

    let profile = state
        .storage
        .lock()
        .unwrap()
        .get_connection(&connection_id)
        .map_err(to_string)?;
    let secret = state
        .storage
        .lock()
        .unwrap()
        .get_connection_secret(&connection_id)
        .map_err(to_string)?;

    if !state.mqtt.lock().unwrap().is_connected(&connection_id) {
        mqtt::connect_runtime(
            app.clone(),
            connection_id.clone(),
            profile,
            secret,
            std::sync::Arc::clone(&state.storage),
            std::sync::Arc::clone(&state.mqtt),
        )
        .map_err(to_string)?;
    }

    state
        .storage
        .lock()
        .unwrap()
        .touch_last_used(&connection_id)
        .map_err(to_string)?;

    let subscriptions = state
        .storage
        .lock()
        .unwrap()
        .list_subscriptions(Some(connection_id.clone()))
        .map_err(to_string)?;

    let enabled: Vec<(String, u8)> = subscriptions
        .into_iter()
        .filter(|item| item.enabled)
        .map(|item| (item.topic_filter, item.qos))
        .collect();

    if !enabled.is_empty() {
        let client = state
            .mqtt
            .lock()
            .unwrap()
            .client(&connection_id)
            .map_err(to_string)?;
        mqtt::subscribe_many(client, enabled)
            .await
            .map_err(|error| format!("恢复订阅失败：{}", to_string(error)))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn disconnect_broker(
    app: AppHandle,
    state: State<'_, SharedState>,
    connection_id: String,
) -> Result<(), String> {
    let client = {
        let mut mqtt = state.mqtt.lock().unwrap();
        mqtt.mark_manual_disconnect(connection_id.clone());
        mqtt.remove(&connection_id)
    };

    if let Some(client) = client {
        mqtt::disconnect_client(client).await.map_err(to_string)?;
    }

    app.emit(
        "connection://status",
        ConnectionEventPayload {
            connection_id,
            status: "disconnected".into(),
            message: None,
        },
    )
    .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn remove_connection(
    app: AppHandle,
    state: State<'_, SharedState>,
    connection_id: String,
) -> Result<(), String> {
    let client = {
        let mut mqtt = state.mqtt.lock().unwrap();
        mqtt.mark_manual_disconnect(connection_id.clone());
        mqtt.remove(&connection_id)
    };

    if let Some(client) = client {
        let _ = mqtt::disconnect_client(client).await;
    }

    state
        .storage
        .lock()
        .unwrap()
        .delete_connection(&connection_id)
        .map_err(to_string)?;

    app.emit(
        "connection://status",
        ConnectionEventPayload {
            connection_id,
            status: "disconnected".into(),
            message: None,
        },
    )
    .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn list_subscriptions(
    state: State<'_, SharedState>,
    connection_id: Option<String>,
) -> Result<Vec<SubscriptionDto>, String> {
    state
        .storage
        .lock()
        .unwrap()
        .list_subscriptions(connection_id)
        .map_err(to_string)
}

#[tauri::command]
pub fn list_message_parsers(
    state: State<'_, SharedState>,
) -> Result<Vec<MessageParserDto>, String> {
    state
        .storage
        .lock()
        .unwrap()
        .list_message_parsers()
        .map_err(to_string)
}

#[tauri::command]
pub fn save_message_parser(
    state: State<'_, SharedState>,
    input: MessageParserInput,
) -> Result<MessageParserDto, String> {
    state
        .storage
        .lock()
        .unwrap()
        .save_message_parser(input)
        .map_err(to_string)
}

#[tauri::command]
pub fn remove_message_parser(
    state: State<'_, SharedState>,
    parser_id: String,
) -> Result<(), String> {
    state
        .storage
        .lock()
        .unwrap()
        .remove_message_parser(&parser_id)
        .map_err(to_string)
}

#[tauri::command]
pub fn test_message_parser(
    request: MessageParserTestRequest,
) -> Result<MessageParserTestResultDto, String> {
    Ok(run_message_parser_test(&request))
}

#[tauri::command]
pub async fn subscribe_topics(
    state: State<'_, SharedState>,
    connection_id: String,
    subscriptions: Vec<SubscriptionInput>,
) -> Result<Vec<SubscriptionDto>, String> {
    let saved = state
        .storage
        .lock()
        .unwrap()
        .save_subscriptions(subscriptions)
        .map_err(to_string)?;

    if state.mqtt.lock().unwrap().is_connected(&connection_id) {
        let client = state
            .mqtt
            .lock()
            .unwrap()
            .client(&connection_id)
            .map_err(to_string)?;
        let topics = saved
            .iter()
            .filter(|item| item.enabled)
            .map(|item| (item.topic_filter.clone(), item.qos))
            .collect();
        mqtt::subscribe_many(client, topics)
            .await
            .map_err(|error| format!("订阅主题失败：{}", to_string(error)))?;
    }

    Ok(saved)
}

#[tauri::command]
pub async fn unsubscribe_topics(
    state: State<'_, SharedState>,
    connection_id: String,
    subscription_ids: Vec<String>,
) -> Result<(), String> {
    let subscriptions = state
        .storage
        .lock()
        .unwrap()
        .get_subscriptions_by_ids(&subscription_ids)
        .map_err(to_string)?;

    if state.mqtt.lock().unwrap().is_connected(&connection_id) {
        let client = state
            .mqtt
            .lock()
            .unwrap()
            .client(&connection_id)
            .map_err(to_string)?;
        let topics = subscriptions
            .iter()
            .map(|subscription| subscription.topic_filter.clone())
            .collect();
        mqtt::unsubscribe_many(client, topics)
            .await
            .map_err(|error| format!("取消订阅失败：{}", to_string(error)))?;
    }

    state
        .storage
        .lock()
        .unwrap()
        .remove_subscriptions(&subscription_ids)
        .map_err(to_string)?;
    Ok(())
}

#[tauri::command]
pub async fn set_subscription_enabled(
    state: State<'_, SharedState>,
    connection_id: String,
    subscription_id: String,
    enabled: bool,
) -> Result<SubscriptionDto, String> {
    let existing = state
        .storage
        .lock()
        .unwrap()
        .get_subscriptions_by_ids(&[subscription_id.clone()])
        .map_err(to_string)?
        .into_iter()
        .next()
        .ok_or_else(|| "未找到订阅项".to_string())?;

    let updated = state
        .storage
        .lock()
        .unwrap()
        .save_subscriptions(vec![SubscriptionInput {
            id: Some(existing.id.clone()),
            connection_id: existing.connection_id.clone(),
            topic_filter: existing.topic_filter.clone(),
            qos: existing.qos,
            parser_id: existing.parser_id.clone(),
            enabled,
            is_preset: existing.is_preset,
            note: existing.note.clone(),
        }])
        .map_err(to_string)?
        .into_iter()
        .next()
        .ok_or_else(|| "订阅状态更新失败".to_string())?;

    if state.mqtt.lock().unwrap().is_connected(&connection_id) {
        let client = state
            .mqtt
            .lock()
            .unwrap()
            .client(&connection_id)
            .map_err(to_string)?;
        if enabled {
            mqtt::subscribe_many(client, vec![(updated.topic_filter.clone(), updated.qos)])
                .await
                .map_err(|error| format!("启用订阅失败：{}", to_string(error)))?;
        } else {
            mqtt::unsubscribe_many(client, vec![updated.topic_filter.clone()])
                .await
                .map_err(|error| format!("停用订阅失败：{}", to_string(error)))?;
        }
    }

    Ok(updated)
}

#[tauri::command]
pub async fn publish_message(
    app: AppHandle,
    state: State<'_, SharedState>,
    request: PublishRequest,
) -> Result<(), String> {
    let client = state
        .mqtt
        .lock()
        .unwrap()
        .client(&request.connection_id)
        .map_err(to_string)?;

    mqtt::publish(
        client,
        request.topic.clone(),
        request.payload_text.as_bytes().to_vec(),
        request.qos,
        request.retain,
    )
    .await
    .map_err(|error| format!("发布消息失败：{}", to_string(error)))?;

    let payload = build_payload_fields(request.payload_text.as_bytes());

    let message = MessageRecordDto {
        id: Uuid::new_v4().to_string(),
        connection_id: request.connection_id.clone(),
        topic: request.topic,
        payload_text: request.payload_text,
        payload_base64: payload.payload_base64,
        raw_payload_hex: payload.raw_payload_hex,
        payload_type: request.payload_type,
        payload_size: payload.payload_size,
        direction: "outgoing".into(),
        qos: request.qos,
        retain: request.retain,
        dup: false,
        parser_id: None,
        parsed_payload_json: None,
        parse_error: None,
        properties_json: None,
        received_at: now_ms(),
    };

    state
        .storage
        .lock()
        .unwrap()
        .insert_message(&message)
        .map_err(to_string)?;

    app.emit("message://received", &message)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_message_history(
    state: State<'_, SharedState>,
    connection_id: String,
    filter: MessageFilter,
) -> Result<MessageHistoryPageDto, String> {
    state
        .storage
        .lock()
        .unwrap()
        .load_message_history(&connection_id, &filter)
        .map_err(to_string)
}

#[tauri::command]
pub fn clear_message_history(
    state: State<'_, SharedState>,
    connection_id: String,
) -> Result<(), String> {
    state
        .storage
        .lock()
        .unwrap()
        .clear_message_history(&connection_id)
        .map_err(to_string)
}

#[tauri::command]
pub fn export_messages(
    state: State<'_, SharedState>,
    request: ExportRequest,
) -> Result<(), String> {
    state
        .storage
        .lock()
        .unwrap()
        .export_messages(&request)
        .map_err(to_string)
}

#[tauri::command]
pub fn get_agent_context(
    state: State<'_, SharedState>,
    connection_id: Option<String>,
) -> Result<AgentContextDto, String> {
    let recent_messages = if let Some(connection_id) = connection_id.as_ref() {
        state
            .storage
            .lock()
            .unwrap()
            .recent_message_count(connection_id)
            .map_err(to_string)?
    } else {
        0
    };

    let connection_health = if let Some(connection_id) = connection_id.as_ref() {
        if state.mqtt.lock().unwrap().is_connected(connection_id) {
            "connected".to_string()
        } else {
            "idle".to_string()
        }
    } else {
        "idle".to_string()
    };

    Ok(state
        .agent
        .lock()
        .unwrap()
        .build_context(connection_id, recent_messages, connection_health))
}

#[tauri::command]
pub fn list_agent_tools(
    _state: State<'_, SharedState>,
) -> Result<Vec<AgentToolDescriptor>, String> {
    // Legacy compatibility command. The frontend should prefer agent-service `/health`
    // for live tool discovery and only use this bridge as a fallback surface.
    list_live_agent_tools().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_app_settings(state: State<'_, SharedState>) -> Result<AppSettingsDto, String> {
    state
        .storage
        .lock()
        .unwrap()
        .get_app_settings()
        .map_err(to_string)
}

#[tauri::command]
pub fn get_agent_settings(state: State<'_, SharedState>) -> Result<AgentSettingsDto, String> {
    state
        .storage
        .lock()
        .unwrap()
        .get_agent_settings()
        .map_err(to_string)
}

#[tauri::command]
pub fn save_agent_settings(
    app: AppHandle,
    state: State<'_, SharedState>,
    settings: AgentSettingsDto,
) -> Result<(), String> {
    state
        .storage
        .lock()
        .unwrap()
        .save_agent_settings(&settings)
        .map_err(to_string)?;

    app.emit(
        "agent://status",
        AgentEventPayload {
            message: "Agent settings updated".into(),
        },
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_app_settings(
    app: AppHandle,
    state: State<'_, SharedState>,
    settings: AppSettingsDto,
) -> Result<(), String> {
    state
        .storage
        .lock()
        .unwrap()
        .save_app_settings(&settings)
        .map_err(to_string)?;

    app.emit(
        "agent://status",
        AgentEventPayload {
            message: "Agent 上下文设置已刷新".into(),
        },
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn to_string(error: AppError) -> String {
    error.to_string()
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
