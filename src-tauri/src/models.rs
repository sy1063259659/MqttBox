use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionFolderDto {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfileDto {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub client_id: String,
    pub protocol: String,
    pub clean_session: bool,
    pub keep_alive_secs: i64,
    pub auto_reconnect: bool,
    pub connect_timeout_ms: i64,
    pub use_tls: bool,
    pub tls_mode: String,
    pub folder_id: Option<String>,
    pub sort_order: i64,
    pub ca_cert_path: Option<String>,
    pub client_cert_path: Option<String>,
    pub client_key_path: Option<String>,
    pub last_connected_at: Option<i64>,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSecretDto {
    pub connection_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResultDto {
    pub ok: bool,
    pub message: String,
    pub latency_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfileInput {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub passphrase: Option<String>,
    pub clean_session: bool,
    pub keep_alive_secs: i64,
    pub auto_reconnect: bool,
    pub connect_timeout_ms: i64,
    pub use_tls: bool,
    pub tls_mode: String,
    pub folder_id: Option<String>,
    pub sort_order: Option<i64>,
    pub ca_cert_path: Option<String>,
    pub client_cert_path: Option<String>,
    pub client_key_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionReorderItem {
    pub connection_id: String,
    pub folder_id: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionDto {
    pub id: String,
    pub connection_id: String,
    pub topic_filter: String,
    pub qos: u8,
    pub parser_id: Option<String>,
    pub enabled: bool,
    pub is_preset: bool,
    pub note: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionInput {
    pub id: Option<String>,
    pub connection_id: String,
    pub topic_filter: String,
    pub qos: u8,
    pub parser_id: Option<String>,
    pub enabled: bool,
    pub is_preset: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageParserDto {
    pub id: String,
    pub name: String,
    pub script: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageParserInput {
    pub id: Option<String>,
    pub name: String,
    pub script: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageParserTestRequest {
    pub script: String,
    pub payload_hex: String,
    pub topic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageParserTestResultDto {
    pub ok: bool,
    pub parsed_payload_json: Option<String>,
    pub parse_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRecordDto {
    pub id: String,
    pub connection_id: String,
    pub topic: String,
    pub payload_text: String,
    pub payload_base64: String,
    pub raw_payload_hex: String,
    pub payload_type: String,
    pub payload_size: i64,
    pub direction: String,
    pub qos: u8,
    pub retain: bool,
    pub dup: bool,
    pub parser_id: Option<String>,
    pub parsed_payload_json: Option<String>,
    pub parse_error: Option<String>,
    pub properties_json: Option<String>,
    pub received_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageFilter {
    pub keyword: String,
    pub topic: String,
    pub direction: String,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageHistoryPageDto {
    pub items: Vec<MessageRecordDto>,
    pub has_more: bool,
    pub next_offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishRequest {
    pub connection_id: String,
    pub topic: String,
    pub payload_text: String,
    pub payload_type: String,
    pub qos: u8,
    pub retain: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub connection_id: String,
    pub format: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsDto {
    pub active_connection_id: Option<String>,
    pub message_history_limit_per_connection: i64,
    pub auto_scroll_messages: bool,
    pub timestamp_format: String,
    pub theme: String,
    pub locale: String,
}

impl Default for AppSettingsDto {
    fn default() -> Self {
        Self {
            active_connection_id: None,
            message_history_limit_per_connection: 5_000,
            auto_scroll_messages: true,
            timestamp_format: "datetime".into(),
            theme: "graphite".into(),
            locale: "system".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolDescriptor {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextDto {
    pub active_connection_id: Option<String>,
    pub selected_topic: Option<String>,
    pub recent_messages: usize,
    pub connection_health: String,
    pub available_tools: Vec<AgentToolDescriptor>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionEventPayload {
    pub connection_id: String,
    pub status: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEventPayload {
    pub message: String,
}
