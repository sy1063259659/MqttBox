import { create } from "zustand";

import type {
  AgentAttachmentDto,
  AgentEvent,
  AgentEventEnvelope,
  AgentSessionMode,
  AgentSafetyLevel,
  ApprovalRequestDto,
  ExecutionPlanDto,
  ExecutionStepDto,
  RunStatus,
} from "@agent-contracts";
import type {
  AgentContextDto,
  AgentHarnessState,
  AgentIncomingEvent,
  AgentThreadMessage,
  AgentTimelineRun,
  AgentToolDescriptor,
  ApprovalResolutionRecord,
  LegacyAgentStatusEvent,
} from "@/features/agent/types";
import {
  createAgentSession,
  getAgentServiceHealth,
  resolveAgentApproval,
  streamAgentMessage,
} from "@/services/agent-service";
import { getAgentContext, listAgentTools } from "@/services/tauri";

interface AgentStore extends AgentHarnessState {
  tools: AgentToolDescriptor[];
  context: AgentContextDto | null;
  draftPrompt: string;
  loadTools: () => Promise<void>;
  loadContext: (connectionId?: string | null) => Promise<void>;
  loadServiceHealth: () => Promise<void>;
  setMode: (mode: AgentSessionMode) => void;
  setSafetyLevel: (safetyLevel: AgentSafetyLevel) => void;
  setDraftPrompt: (prompt: string) => void;
  submitDraftMessage: () => Promise<void>;
  addDraftAttachments: (attachments: AgentAttachmentDto[]) => void;
  removeDraftAttachment: (attachmentId: string) => void;
  resolveApproval: (
    requestId: string,
    outcome: ApprovalResolutionRecord["outcome"],
  ) => Promise<void>;
  applyIncomingEvent: (event: AgentIncomingEvent) => void;
  setStatusMessage: (message: string | null) => void;
}

const FALLBACK_RUN_STATUS: AgentStore["runStatus"] = "idle";
const FALLBACK_MODE: AgentSessionMode = "chat";
const FALLBACK_SAFETY: AgentSafetyLevel = "confirm";
const FALLBACK_TIMELINE: AgentHarnessState["timeline"] = {
  activeRunId: null,
  runs: [],
  latestPlan: null,
};

function nowIso() {
  return new Date().toISOString();
}

function upsertMessage(messages: AgentThreadMessage[], message: AgentThreadMessage) {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index < 0) {
    return [...messages, message];
  }

  const next = [...messages];
  next[index] = message;
  return next;
}

function upsertRun(runs: AgentTimelineRun[], nextRun: AgentTimelineRun) {
  const index = runs.findIndex((item) => item.id === nextRun.id);
  if (index < 0) {
    return [nextRun, ...runs];
  }

  const next = [...runs];
  next[index] = nextRun;
  return next;
}

function mapStatusToRunState(status: RunStatus): AgentStore["runStatus"] {
  return status;
}

function resetRuntimeState() {
  return {
    session: null,
    timeline: FALLBACK_TIMELINE,
    messages: [],
    approvals: [],
    approvalHistory: [],
    artifacts: [],
    runStatus: FALLBACK_RUN_STATUS,
    transportFlavor: "unknown" as const,
    statusMessage: null,
  };
}

function isEnvelope(event: AgentIncomingEvent): event is AgentEventEnvelope {
  return typeof event === "object" && event !== null && "type" in event && "payload" in event;
}

function isLegacyStatusEvent(event: AgentIncomingEvent): event is LegacyAgentStatusEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "message" in event &&
    !("type" in event) &&
    typeof event.message === "string"
  );
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  tools: [],
  context: null,
  session: null,
  mode: FALLBACK_MODE,
  safetyLevel: FALLBACK_SAFETY,
  timeline: {
    ...FALLBACK_TIMELINE,
  },
  messages: [],
  draftAttachments: [],
  approvals: [],
  approvalHistory: [],
  artifacts: [],
  capabilities: [],
  transportFlavor: "unknown",
  runStatus: FALLBACK_RUN_STATUS,
  statusMessage: null,
  draftPrompt: "",
  async loadTools() {
    try {
      const tools = await listAgentTools();
      set({ tools });
    } catch (error) {
      set({
        statusMessage: error instanceof Error ? error.message : "Failed to load tools",
      });
    }
  },
  async loadContext(connectionId) {
    try {
      const context = await getAgentContext(connectionId ?? undefined);
      set((state) => ({
        context,
        tools: state.tools.length > 0 ? state.tools : context.availableTools,
      }));
    } catch (error) {
      set({
        context: null,
        statusMessage: error instanceof Error ? error.message : "Failed to load agent context",
      });
    }
  },
  async loadServiceHealth() {
    try {
      const health = await getAgentServiceHealth();
      set({
        capabilities: health.capabilities,
        statusMessage: !health.model?.enabled
          ? "Agent is disabled"
          : !health.model?.configured
            ? "Agent service is reachable, but the model is not configured"
            : "Agent service is ready",
      });
    } catch (error) {
      set({
        capabilities: [],
        statusMessage: error instanceof Error ? error.message : "Agent service is unreachable",
      });
    }
  },
  setMode(mode) {
    set((state) => ({
      mode,
      ...resetRuntimeState(),
      statusMessage:
        state.mode === mode ? state.statusMessage : "Mode changed, next send will start a new session",
    }));
  },
  setSafetyLevel(safetyLevel) {
    set((state) => ({
      safetyLevel,
      ...resetRuntimeState(),
      statusMessage:
        state.safetyLevel === safetyLevel
          ? state.statusMessage
          : "Safety level changed, next send will start a new session",
    }));
  },
  setDraftPrompt(prompt) {
    set({ draftPrompt: prompt });
  },
  async submitDraftMessage() {
    const state = get();
    const content = state.draftPrompt.trim();
    if (!content) {
      return;
    }

    try {
      set({ statusMessage: "Sending to agent service..." });

      let session = state.session;
      if (!session) {
        const sessionResult = await createAgentSession({
          mode: state.mode,
          safetyLevel: state.safetyLevel,
        });
        session = sessionResult.session;
        set({ session });
        for (const event of sessionResult.events) {
          get().applyIncomingEvent(event);
        }
      }

      const done = await streamAgentMessage({
        sessionId: session.id,
        content,
        attachments: state.draftAttachments,
        onEvent: (event) => {
          get().applyIncomingEvent(event);
        },
      });

      set({
        draftPrompt: "",
        draftAttachments: [],
        statusMessage: `Agent stream completed (${done.assistantMessageId})`,
      });
    } catch (error) {
      set({
        statusMessage:
          error instanceof Error ? error.message : "Failed to talk to agent service",
      });
    }
  },
  addDraftAttachments(attachments) {
    set((state) => ({
      draftAttachments: [...state.draftAttachments, ...attachments],
    }));
  },
  removeDraftAttachment(attachmentId) {
    set((state) => ({
      draftAttachments: state.draftAttachments.filter((item) => item.id !== attachmentId),
    }));
  },
  async resolveApproval(requestId, outcome) {
    const sessionId = get().session?.id;
    if (!sessionId) {
      return;
    }

    try {
      set({
        statusMessage:
          outcome === "approved"
            ? "Resolving approval..."
            : outcome === "rejected"
              ? "Rejecting approval..."
              : "Expiring approval...",
      });
      const result = await resolveAgentApproval({
        sessionId,
        requestId,
        outcome,
      });

      for (const event of result.events) {
        get().applyIncomingEvent(event);
      }
    } catch (error) {
      set({
        statusMessage: error instanceof Error ? error.message : "Failed to resolve approval",
      });
    }
  },
  applyIncomingEvent(event) {
    if (isLegacyStatusEvent(event)) {
      set({
        statusMessage: event.message,
        transportFlavor: "legacy",
      });
      return;
    }

    if (!isEnvelope(event)) {
      return;
    }

    const incoming = event as AgentEvent;

    set((state) => {
      if (incoming.type === "session.start") {
        return {
          session: incoming.payload.session,
          mode: incoming.payload.session.mode,
          safetyLevel: incoming.payload.session.safetyLevel,
          transportFlavor: "contract" as const,
          statusMessage: "Session started",
        };
      }

      if (incoming.type === "session.message") {
        const nextMessage: AgentThreadMessage = {
          id: incoming.payload.messageId,
          role: incoming.payload.role,
          content: incoming.payload.content,
          mode: incoming.payload.mode,
          safetyLevel: incoming.payload.safetyLevel,
          createdAt: incoming.timestamp,
          attachments: incoming.payload.attachments ?? [],
          runId: incoming.runId ?? null,
          isStreaming: false,
        };

        return {
          messages: upsertMessage(state.messages, nextMessage),
          transportFlavor: "contract" as const,
        };
      }

      if (incoming.type === "assistant.delta") {
        const existing = state.messages.find((item) => item.id === incoming.payload.messageId);
        const next = existing
          ? {
              ...existing,
              content: `${existing.content}${incoming.payload.delta}`,
              isStreaming: true,
            }
          : {
              id: incoming.payload.messageId,
              role: "assistant" as const,
              content: incoming.payload.delta,
              mode: state.mode,
              safetyLevel: state.safetyLevel,
              createdAt: incoming.timestamp,
              attachments: [],
              runId: incoming.runId ?? null,
              isStreaming: true,
            };

        return {
          messages: upsertMessage(state.messages, next),
          transportFlavor: "contract" as const,
        };
      }

      if (incoming.type === "assistant.final") {
        const existing = state.messages.find((item) => item.id === incoming.payload.messageId);
        const currentRun =
          incoming.runId == null
            ? null
            : state.timeline.runs.find((item) => item.id === incoming.runId) ?? null;
        const next = existing
          ? {
              ...existing,
              content: incoming.payload.content,
              isStreaming: false,
            }
          : {
              id: incoming.payload.messageId,
              role: "assistant" as const,
              content: incoming.payload.content,
              mode: state.mode,
              safetyLevel: state.safetyLevel,
              createdAt: incoming.timestamp,
              attachments: [],
              runId: incoming.runId ?? null,
              isStreaming: false,
            };

        return {
          messages: upsertMessage(state.messages, next),
          runStatus:
            incoming.runId == null
              ? state.runStatus
              : incoming.payload.finishReason === "error"
                ? "failed"
                : currentRun?.status === "completed"
                  ? "completed"
                  : "running",
          transportFlavor: "contract" as const,
        };
      }

      if (incoming.type === "plan.ready") {
        const plan: ExecutionPlanDto = incoming.payload.plan;
        const currentRun = state.timeline.runs.find((item) => item.id === plan.runId);
        const nextRun: AgentTimelineRun =
          currentRun ?? {
            id: plan.runId,
            sessionId: incoming.sessionId,
            mode: state.mode,
            safetyLevel: state.safetyLevel,
            capabilityId: plan.capabilityId,
            status: "planning",
            goal: plan.goal,
            createdAt: incoming.timestamp,
            startedAt: null,
            completedAt: null,
            steps: [],
          };

        return {
          timeline: {
            activeRunId: plan.runId,
            latestPlan: plan,
            runs: upsertRun(state.timeline.runs, {
              ...nextRun,
              capabilityId: plan.capabilityId ?? nextRun.capabilityId,
              goal: plan.goal,
              steps: plan.steps,
            }),
          },
          runStatus: "planning" as const,
          transportFlavor: "contract" as const,
        };
      }

      if (
        incoming.type === "plan.step.started" ||
        incoming.type === "plan.step.completed" ||
        incoming.type === "plan.step.failed"
      ) {
        const step: ExecutionStepDto = incoming.payload.step;
        const run = state.timeline.runs.find((item) => item.id === step.runId);
        const fallbackRun: AgentTimelineRun = {
          id: step.runId,
          sessionId: incoming.sessionId,
          mode: state.mode,
          safetyLevel: state.safetyLevel,
          capabilityId: null,
          status:
            incoming.type === "plan.step.failed"
              ? "failed"
              : incoming.type === "plan.step.completed"
                ? "running"
                : "running",
          goal: "Runtime plan",
          createdAt: incoming.timestamp,
          startedAt: incoming.timestamp,
          completedAt: null,
          steps: [],
        };

        const baseRun = run ?? fallbackRun;
        const stepIndex = baseRun.steps.findIndex((item) => item.id === step.id);
        const nextSteps =
          stepIndex < 0
            ? [...baseRun.steps, step]
            : baseRun.steps.map((item) => (item.id === step.id ? step : item));

        const nextRunStatus: RunStatus =
          incoming.type === "plan.step.failed"
            ? "failed"
            : nextSteps.every((item) => item.status === "completed")
              ? "completed"
              : "running";

        return {
          timeline: {
            ...state.timeline,
            activeRunId: step.runId,
            runs: upsertRun(state.timeline.runs, {
              ...baseRun,
              status: nextRunStatus,
              completedAt: nextRunStatus === "completed" ? nowIso() : null,
              steps: nextSteps,
            }),
          },
          runStatus: mapStatusToRunState(nextRunStatus),
          transportFlavor: "contract" as const,
        };
      }

      if (incoming.type === "approval.requested") {
        const request: ApprovalRequestDto = incoming.payload.request;
        const existing = state.approvals.some((item) => item.id === request.id);

        return {
          approvals: existing ? state.approvals : [request, ...state.approvals],
          runStatus: "awaiting_approval" as const,
          transportFlavor: "contract" as const,
        };
      }

      if (incoming.type === "approval.resolved") {
        const resolution: ApprovalResolutionRecord = {
          requestId: incoming.payload.requestId,
          outcome: incoming.payload.outcome,
          resolvedAt: incoming.payload.resolvedAt,
          resolver: incoming.payload.resolver,
        };
        const currentRun =
          incoming.runId == null
            ? null
            : state.timeline.runs.find((item) => item.id === incoming.runId) ?? null;

        return {
          approvals: state.approvals.filter((item) => item.id !== incoming.payload.requestId),
          approvalHistory: [resolution, ...state.approvalHistory],
          runStatus:
            incoming.payload.outcome === "approved"
              ? currentRun?.status === "completed"
                ? "completed"
                : "running"
              : "failed",
          statusMessage:
            incoming.payload.outcome === "approved"
              ? "Approval accepted"
              : incoming.payload.outcome === "rejected"
                ? "Approval rejected"
                : "Approval expired",
          transportFlavor: "contract" as const,
        };
      }

      if (incoming.type === "artifact.ready") {
        const artifact = incoming.payload.artifact;
        const hasArtifact = state.artifacts.some((item) => item.id === artifact.id);

        return {
          artifacts: hasArtifact ? state.artifacts : [artifact, ...state.artifacts],
          transportFlavor: "contract" as const,
        };
      }

      if (incoming.type === "service.error") {
        const nextRuns =
          incoming.runId == null
            ? state.timeline.runs
            : state.timeline.runs.map((run) =>
                run.id === incoming.runId ? { ...run, status: "failed" as const } : run,
              );
        return {
          timeline: {
            ...state.timeline,
            runs: nextRuns,
          },
          runStatus: incoming.runId == null ? state.runStatus : "failed",
          statusMessage: incoming.payload.message,
          transportFlavor: "contract" as const,
        };
      }

      return state;
    });
  },
  setStatusMessage(message) {
    set({ statusMessage: message });
  },
}));
