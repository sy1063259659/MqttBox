use crate::models::AgentContextDto;

pub struct AgentHost;

impl AgentHost {
    pub fn new() -> Self {
        Self
    }

    pub fn build_context(
        &self,
        active_connection_id: Option<String>,
        recent_messages: usize,
        connection_health: String,
    ) -> AgentContextDto {
        AgentContextDto {
            active_connection_id,
            selected_topic: None,
            recent_messages,
            connection_health,
            available_tools: Vec::new(),
        }
    }
}
