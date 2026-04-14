import type {
  AgentArtifactDto,
  AgentAttachmentDto,
  AgentEvent,
  AgentEventEnvelope,
  AgentRunDto,
  AgentSafetyLevel,
  AgentSessionDto,
  AgentSessionMode,
  ApprovalRequestDto,
  CapabilityDescriptor,
  ExecutionPlanDto,
  ExecutionStepDto,
  RunStatus,
  ToolDescriptor,
} from "@agent-contracts";

export type AgentToolDescriptor = ToolDescriptor;

export interface AgentContextDto {
  activeConnectionId?: string | null;
  selectedTopic?: string | null;
  recentMessages: number;
  connectionHealth: string;
  availableTools: AgentToolDescriptor[];
}

export interface LegacyAgentStatusEvent {
  message: string;
}

export type AgentIncomingEvent = AgentEvent | AgentEventEnvelope | LegacyAgentStatusEvent;

export interface AgentTimelineRun extends AgentRunDto {
  steps: ExecutionStepDto[];
}

export interface AgentTimelineState {
  activeRunId: string | null;
  runs: AgentTimelineRun[];
  latestPlan: ExecutionPlanDto | null;
}

export interface AgentThreadMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  mode: AgentSessionMode;
  safetyLevel: AgentSafetyLevel;
  createdAt: string;
  attachments: AgentAttachmentDto[];
  runId?: string | null;
  isStreaming?: boolean;
}

export interface ApprovalResolutionRecord {
  requestId: string;
  outcome: "approved" | "rejected" | "expired";
  resolvedAt: string;
  resolver?: string | null;
}

export interface AgentHarnessState {
  session: AgentSessionDto | null;
  mode: AgentSessionMode;
  safetyLevel: AgentSafetyLevel;
  timeline: AgentTimelineState;
  messages: AgentThreadMessage[];
  draftAttachments: AgentAttachmentDto[];
  approvals: ApprovalRequestDto[];
  approvalHistory: ApprovalResolutionRecord[];
  artifacts: AgentArtifactDto[];
  capabilities: CapabilityDescriptor[];
  transportFlavor: "unknown" | "legacy" | "contract";
  runStatus: RunStatus | "idle";
  statusMessage: string | null;
}
