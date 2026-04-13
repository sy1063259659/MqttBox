use std::sync::{Arc, Mutex};

use tauri::AppHandle;

use crate::{agent::AgentHost, error::AppResult, mqtt::MqttManager, storage::StorageService};

pub struct SharedState {
    pub storage: Arc<Mutex<StorageService>>,
    pub mqtt: Arc<Mutex<MqttManager>>,
    pub agent: Arc<Mutex<AgentHost>>,
}

impl SharedState {
    pub fn new(app: &AppHandle) -> AppResult<Self> {
        Ok(Self {
            storage: Arc::new(Mutex::new(StorageService::new(app)?)),
            mqtt: Arc::new(Mutex::new(MqttManager::default())),
            agent: Arc::new(Mutex::new(AgentHost::new())),
        })
    }
}
