import type {
  AgentArtifactDto,
  AgentAttachmentDto,
  AgentEvent,
  AgentEventEnvelope,
  AgentRunDto,
  AgentSessionContextSummaryDto,
  AgentSessionDetailDto,
  AgentServiceConfigDto,
  AgentSafetyLevel,
  AgentSessionDto,
  AgentThreadMessageDto,
  AgentSessionMode,
  ApprovalRequestDto,
  ApprovalResolutionRecordDto,
  CapabilityDescriptor,
  ExecutionPlanDto,
  ExecutionStepDto,
  RunStatus,
  ToolDescriptor,
} from "@agent-contracts";

/**
 * Legacy compatibility alias for the Tauri bridge only.
 * Live tool discovery should use the agent-service ToolDescriptor payload from `/health`.
 */
export type AgentToolDescriptor = ToolDescriptor;

export interface AgentContextDto {
  activeConnectionId?: string | null;
  selectedTopic?: string | null;
  recentMessages: number;
  connectionHealth: string;
  /**
   * Legacy compatibility field from the Tauri context bridge.
   * Live tool discovery should come from agent-service health instead.
   */
  availableTools?: AgentToolDescriptor[];
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

export interface AgentThreadMessage extends AgentThreadMessageDto {
  isStreaming?: boolean;
  isOptimistic?: boolean;
}

export type ApprovalResolutionRecord = ApprovalResolutionRecordDto;

export interface AgentSessionSummary extends AgentSessionDto {}

export interface AgentSessionDetail
  extends Omit<AgentSessionDetailDto, "messages" | "timeline"> {
  messages: AgentThreadMessage[];
  timeline: AgentTimelineState;
}

export interface AgentHarnessState {
  session: AgentSessionDto | null;
  activeSessionId: string | null;
  sessionSummaries: AgentSessionSummary[];
  sessionDetailsById: Record<string, AgentSessionDetail>;
  mode: AgentSessionMode;
  safetyLevel: AgentSafetyLevel;
  timeline: AgentTimelineState;
  messages: AgentThreadMessage[];
  draftAttachments: AgentAttachmentDto[];
  approvals: ApprovalRequestDto[];
  approvalHistory: ApprovalResolutionRecord[];
  artifacts: AgentArtifactDto[];
  contextSummary: AgentSessionContextSummaryDto | null;
  capabilities: CapabilityDescriptor[];
  serviceConfig: AgentServiceConfigDto | null;
  transportFlavor: "unknown" | "legacy" | "contract";
  runStatus: RunStatus | "idle";
  statusMessage: string | null;
}
