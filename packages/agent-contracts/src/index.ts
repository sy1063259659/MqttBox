export type AgentSessionMode = "chat" | "execute";

export type AgentSafetyLevel = "observe" | "draft" | "confirm" | "auto";

export type RunStatus =
  | "queued"
  | "planning"
  | "awaiting_tool"
  | "awaiting_approval"
  | "running"
  | "producing_artifact"
  | "completed"
  | "failed"
  | "cancelled";

export type ExecutionStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ToolKind = "context" | "draft" | "mutation";

export type ToolRiskLevel = "low" | "medium" | "high";

export type MemoryScopeType = "global" | "connection" | "topicPattern" | "parser";

export interface AgentSessionDto {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  lastMessagePreview?: string | null;
  draftMode: AgentSessionMode;
  draftSafetyLevel: AgentSafetyLevel;
  workspaceId?: string | null;
}

export interface AgentThreadMessageDto {
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

export interface ApprovalResolutionRecordDto {
  requestId: string;
  outcome: "approved" | "rejected" | "expired";
  resolvedAt: string;
  resolver?: string | null;
}

export interface AgentSessionContextSummaryDto {
  content: string;
  updatedAt: string;
  sourceMessageCount: number;
  compressedUntil?: string | null;
}

export interface AgentTimelineDto {
  activeRunId: string | null;
  runs: Array<AgentRunDto & { steps: ExecutionStepDto[] }>;
  latestPlan: ExecutionPlanDto | null;
}

export interface AgentSessionDetailDto {
  session: AgentSessionDto;
  timeline: AgentTimelineDto;
  messages: AgentThreadMessageDto[];
  approvals: ApprovalRequestDto[];
  approvalHistory: ApprovalResolutionRecordDto[];
  artifacts: AgentArtifactDto[];
  contextSummary?: AgentSessionContextSummaryDto | null;
}

export interface AgentRunDto {
  id: string;
  sessionId: string;
  mode: AgentSessionMode;
  safetyLevel: AgentSafetyLevel;
  capabilityId?: string | null;
  status: RunStatus;
  goal: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface ExecutionStepDto {
  id: string;
  runId: string;
  index: number;
  title: string;
  kind: string;
  status: ExecutionStepStatus;
  toolName?: string | null;
  attempt: number;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
}

export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
  toolKind: ToolKind;
  riskLevel: ToolRiskLevel;
  allowedModes: AgentSessionMode[];
  minSafetyLevel: AgentSafetyLevel;
  requiresApproval: boolean;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
  timeoutMs?: number | null;
  retryPolicy?: {
    maxAttempts: number;
  } | null;
  idempotent?: boolean;
}

export interface ApprovalRequestDto {
  id: string;
  runId: string;
  stepId?: string | null;
  toolName?: string | null;
  title: string;
  actionSummary: string;
  reason: string;
  riskLevel: ToolRiskLevel;
  safetyLevel: AgentSafetyLevel;
  inputPreview?: string | null;
  requestedAt: string;
  expiresAt?: string | null;
}

export interface AgentArtifactDto {
  id: string;
  runId: string;
  capabilityId: string;
  type: string;
  schemaVersion: number;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface WorkspaceMemoryDto {
  id: string;
  kind: string;
  scopeType: MemoryScopeType;
  scopeRef: string;
  title: string;
  content: string;
  summary: string;
  language: string;
  createdAt: string;
  updatedAt: string;
  source: string;
  pinned: boolean;
}

export interface CapabilityDescriptor {
  id: string;
  name: string;
  description: string;
  supportedModes: AgentSessionMode[];
  defaultSafetyLevel: AgentSafetyLevel;
  enabled: boolean;
}

export interface AgentAttachmentDto {
  id: string;
  kind: "image";
  source: "file" | "drop" | "paste";
  mimeType: string;
  filename?: string | null;
  dataUrl: string;
  byteSize?: number | null;
}

export interface ParserArtifactEditorPayload {
  name: string;
  script: string;
  suggestedTestPayloadHex?: string;
}

export interface ParserArtifactReviewPayload {
  summary: string;
  assumptions: string[];
  risks: string[];
  nextSteps: string[];
}

export interface ParserScriptArtifactPayload {
  editorPayload: ParserArtifactEditorPayload;
  reviewPayload: ParserArtifactReviewPayload;
  suggestedTopicFilter?: string;
  sourceSampleSummary?: string;
}

export interface AgentServiceConfigDto {
  service: string;
  model?: {
    provider: string;
    configured: boolean;
    model: string;
    baseUrl: string;
    enabled: boolean;
    protocol: "responses" | "chat_completions";
  };
  transport: {
    modes: string[];
  };
  runtime: {
    deepagentsRuntime: string;
  };
  supportsImageInput: boolean;
  supportsParserAuthoring: boolean;
  supportsApproval: boolean;
  maxAttachmentCount: number;
  maxAttachmentBytes: number;
  acceptedImageMimeTypes: string[];
}

export interface ExecutionPlanDto {
  runId: string;
  capabilityId?: string | null;
  goal: string;
  steps: ExecutionStepDto[];
}

export interface SessionStartPayload {
  session: AgentSessionDto;
}

export interface SessionMessagePayload {
  messageId: string;
  role: "system" | "user" | "assistant";
  content: string;
  mode: AgentSessionMode;
  safetyLevel: AgentSafetyLevel;
  attachments?: AgentAttachmentDto[];
}

export interface AssistantDeltaPayload {
  messageId: string;
  delta: string;
}

export interface AssistantFinalPayload {
  messageId: string;
  content: string;
  finishReason?: "stop" | "length" | "tool_call" | "error" | null;
}

export interface PlanReadyPayload {
  plan: ExecutionPlanDto;
}

export interface RunStartedPayload {
  run: AgentRunDto;
}

export interface RunStatusPayload {
  runId: string;
  status: RunStatus;
  message?: string | null;
}

export interface RunCompletedPayload {
  run: AgentRunDto;
  finishReason?: "stop" | "length" | "tool_call" | "error" | null;
}

export interface PlanStepStartedPayload {
  step: ExecutionStepDto;
}

export interface PlanStepCompletedPayload {
  step: ExecutionStepDto;
}

export interface PlanStepFailedPayload {
  step: ExecutionStepDto;
  error: string;
}

export interface ToolRequestPayload {
  callId: string;
  stepId?: string | null;
  tool: ToolDescriptor;
  input: unknown;
}

export interface ToolResultPayload {
  callId: string;
  stepId?: string | null;
  toolId: string;
  ok: boolean;
  output?: unknown;
  error?: string | null;
}

export interface ApprovalRequestedPayload {
  request: ApprovalRequestDto;
}

export interface ApprovalResolvedPayload {
  requestId: string;
  outcome: "approved" | "rejected" | "expired";
  resolvedAt: string;
  resolver?: string | null;
}

export interface ArtifactReadyPayload {
  artifact: AgentArtifactDto;
}

export interface ServiceErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
  details?: unknown;
}

export type AgentEventType =
  | "session.start"
  | "session.message"
  | "run.started"
  | "run.status"
  | "run.completed"
  | "assistant.delta"
  | "assistant.final"
  | "plan.ready"
  | "plan.step.started"
  | "plan.step.completed"
  | "plan.step.failed"
  | "tool.request"
  | "tool.result"
  | "approval.requested"
  | "approval.resolved"
  | "artifact.ready"
  | "service.error";

export interface AgentEventPayloadByType {
  "session.start": SessionStartPayload;
  "session.message": SessionMessagePayload;
  "run.started": RunStartedPayload;
  "run.status": RunStatusPayload;
  "run.completed": RunCompletedPayload;
  "assistant.delta": AssistantDeltaPayload;
  "assistant.final": AssistantFinalPayload;
  "plan.ready": PlanReadyPayload;
  "plan.step.started": PlanStepStartedPayload;
  "plan.step.completed": PlanStepCompletedPayload;
  "plan.step.failed": PlanStepFailedPayload;
  "tool.request": ToolRequestPayload;
  "tool.result": ToolResultPayload;
  "approval.requested": ApprovalRequestedPayload;
  "approval.resolved": ApprovalResolvedPayload;
  "artifact.ready": ArtifactReadyPayload;
  "service.error": ServiceErrorPayload;
}

export interface AgentEventEnvelope<
  TType extends AgentEventType = AgentEventType,
  TPayload = AgentEventPayloadByType[TType],
> {
  id: string;
  type: TType;
  timestamp: string;
  sessionId: string;
  runId?: string | null;
  payload: TPayload;
}

export type AgentEvent = {
  [TType in AgentEventType]: AgentEventEnvelope<TType>;
}[AgentEventType];
