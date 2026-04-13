export interface AgentToolDescriptor {
  id: string;
  name: string;
  description: string;
}

export interface AgentContextDto {
  activeConnectionId?: string | null;
  selectedTopic?: string | null;
  recentMessages: number;
  connectionHealth: string;
  availableTools: AgentToolDescriptor[];
}
