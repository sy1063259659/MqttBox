use crate::models::{AgentContextDto, AgentToolDescriptor};

pub struct AgentHost {
    tools: Vec<AgentToolDescriptor>,
}

impl AgentHost {
    pub fn new() -> Self {
        Self {
            tools: vec![
                AgentToolDescriptor {
                    id: "connection-health".into(),
                    name: "查看连接状态".into(),
                    description: "读取当前连接状态与最近错误，用于生成诊断建议。".into(),
                },
                AgentToolDescriptor {
                    id: "recent-messages".into(),
                    name: "读取最近消息".into(),
                    description: "读取最近到达的消息，辅助分析 topic 与 payload 模式。".into(),
                },
                AgentToolDescriptor {
                    id: "suggest-subscriptions".into(),
                    name: "生成订阅建议".into(),
                    description: "根据最近消息与当前主题输入生成订阅建议。".into(),
                },
                AgentToolDescriptor {
                    id: "draft-publish".into(),
                    name: "生成发布草稿".into(),
                    description: "根据上下文和当前 topic 生成可编辑的发布消息草稿。".into(),
                },
            ],
        }
    }

    pub fn list_tools(&self) -> Vec<AgentToolDescriptor> {
        self.tools.clone()
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
            available_tools: self.tools.clone(),
        }
    }
}
