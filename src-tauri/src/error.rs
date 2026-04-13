use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Serde(#[from] serde_json::Error),
    #[error(transparent)]
    MqttClient(#[from] rumqttc::ClientError),
    #[error(transparent)]
    MqttConnection(#[from] rumqttc::ConnectionError),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

pub type AppResult<T> = Result<T, AppError>;
