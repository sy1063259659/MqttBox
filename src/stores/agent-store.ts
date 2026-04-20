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
  AgentSessionDetail,
  AgentSessionSummary,
  AgentThreadMessage,
  AgentTimelineRun,
  AgentToolDescriptor,
  ApprovalResolutionRecord,
  LegacyAgentStatusEvent,
} from "@/features/agent/types";
import {
  createAgentSession,
  getAgentServiceConfig,
  getAgentServiceHealth,
  getAgentSessionDetail,
  listAgentSessions,
  resolveAgentApproval,
  streamAgentMessage,
} from "@/services/agent-service";
import { getAgentContext } from "@/services/tauri";

type PendingAssistantPhase =
  | "sending"
  | "analyzing"
  | "planning"
  | "preparing"
  | "waiting_for_approval";

interface PendingAssistantState {
  userMessageId: string;
  runId: string | null;
  phase: PendingAssistantPhase;
  detail: string | null;
  createdAt: string;
}

const FALLBACK_RUN_STATUS: AgentStore["runStatus"] = "idle";
const FALLBACK_MODE: AgentSessionMode = "chat";
const FALLBACK_SAFETY: AgentSafetyLevel = "confirm";
const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["completed", "failed", "cancelled"]);
const FALLBACK_TIMELINE: AgentHarnessState["timeline"] = {
  activeRunId: null,
  runs: [],
  latestPlan: null,
};

interface AgentStore extends AgentHarnessState {
  tools: AgentToolDescriptor[];
  context: AgentContextDto | null;
  draftPrompt: string;
  isSubmitting: boolean;
  pendingAssistantState: PendingAssistantState | null;
  activePhaseSummary: PendingAssistantPhase | null;
  loadTools: () => Promise<void>;
  loadContext: (connectionId?: string | null) => Promise<void>;
  loadServiceHealth: () => Promise<void>;
  loadServiceConfig: () => Promise<void>;
  loadSessions: () => Promise<void>;
  loadSessionDetail: (sessionId: string) => Promise<void>;
  initializeSessionState: () => Promise<void>;
  createNewSession: () => Promise<void>;
  setActiveSession: (sessionId: string) => Promise<void>;
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

function nowIso() {
  return new Date().toISOString();
}

function attachmentsMatch(left: AgentAttachmentDto[], right: AgentAttachmentDto[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => {
    const candidate = right[index];
    return (
      item.kind === candidate.kind &&
      item.mimeType === candidate.mimeType &&
      item.filename === candidate.filename &&
      item.byteSize === candidate.byteSize &&
      item.dataUrl === candidate.dataUrl
    );
  });
}

function matchOptimisticMessageIndex(messages: AgentThreadMessage[], message: AgentThreadMessage) {
  return messages.findIndex(
    (item) =>
      item.isOptimistic &&
      item.role === message.role &&
      item.content === message.content &&
      item.mode === message.mode &&
      item.safetyLevel === message.safetyLevel &&
      attachmentsMatch(item.attachments, message.attachments),
  );
}

function upsertMessage(messages: AgentThreadMessage[], message: AgentThreadMessage) {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index < 0) {
    const optimisticIndex = matchOptimisticMessageIndex(messages, message);
    if (optimisticIndex >= 0) {
      const next = [...messages];
      next[optimisticIndex] = {
        ...message,
        isOptimistic: false,
      };
      return next;
    }
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

function upsertApproval(approvals: ApprovalRequestDto[], request: ApprovalRequestDto) {
  const index = approvals.findIndex((item) => item.id === request.id);
  if (index < 0) {
    return [request, ...approvals];
  }

  const next = [...approvals];
  next[index] = request;
  return next;
}

function upsertArtifact(artifacts: AgentStore["artifacts"], artifact: AgentStore["artifacts"][number]) {
  const index = artifacts.findIndex((item) => item.id === artifact.id);
  if (index < 0) {
    return [artifact, ...artifacts];
  }

  const next = [...artifacts];
  next[index] = artifact;
  return next;
}

function mapStatusToRunState(status: RunStatus): AgentStore["runStatus"] {
  return status;
}

function isRunTerminal(status: AgentStore["runStatus"]) {
  return status === "idle" || TERMINAL_RUN_STATUSES.has(status as RunStatus);
}

function getPendingPhaseFromRunStatus(status: RunStatus): PendingAssistantPhase | null {
  if (status === "planning") {
    return "planning";
  }
  if (status === "awaiting_approval") {
    return "waiting_for_approval";
  }
  if (status === "producing_artifact") {
    return "preparing";
  }
  if (status === "queued" || status === "awaiting_tool" || status === "running") {
    return "analyzing";
  }
  return null;
}

function emptyDetail(summary: AgentSessionSummary): AgentSessionDetail {
  return {
    session: summary,
    timeline: {
      ...FALLBACK_TIMELINE,
    },
    messages: [],
    approvals: [],
    approvalHistory: [],
    artifacts: [],
    contextSummary: null,
  };
}

function mirrorFromDetail(detail: AgentSessionDetail | null, state: Pick<AgentStore, "mode" | "safetyLevel">) {
  return {
    session: detail?.session ?? null,
    timeline: detail?.timeline ?? { ...FALLBACK_TIMELINE },
    messages: detail?.messages ?? [],
    approvals: detail?.approvals ?? [],
    approvalHistory: detail?.approvalHistory ?? [],
    artifacts: detail?.artifacts ?? [],
    contextSummary: detail?.contextSummary ?? null,
    mode: detail?.session.draftMode ?? state.mode,
    safetyLevel: detail?.session.draftSafetyLevel ?? state.safetyLevel,
  };
}

function syncSummary(
  summaries: AgentSessionSummary[],
  session: AgentSessionSummary,
): AgentSessionSummary[] {
  const next = [...summaries];
  const index = next.findIndex((item) => item.id === session.id);
  if (index < 0) {
    next.unshift(session);
  } else {
    next[index] = session;
  }

  return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function buildDetailFromState(state: AgentStore, session: AgentSessionSummary): AgentSessionDetail {
  return {
    session,
    timeline: state.timeline,
    messages: state.messages,
    approvals: state.approvals,
    approvalHistory: state.approvalHistory,
    artifacts: state.artifacts,
    contextSummary: state.contextSummary,
  };
}

function syncActiveSessionDraft(
  state: AgentStore,
  updates: Partial<Pick<AgentSessionSummary, "draftMode" | "draftSafetyLevel" | "updatedAt">>,
) {
  const activeSessionId = state.activeSessionId;
  if (!activeSessionId) {
    return {
      session: state.session,
      sessionSummaries: state.sessionSummaries,
      sessionDetailsById: state.sessionDetailsById,
    };
  }

  const baseSession =
    state.sessionDetailsById[activeSessionId]?.session ??
    state.session ??
    state.sessionSummaries.find((item) => item.id === activeSessionId) ??
    null;

  if (!baseSession) {
    return {
      session: state.session,
      sessionSummaries: state.sessionSummaries,
      sessionDetailsById: state.sessionDetailsById,
    };
  }

  const nextSession = {
    ...baseSession,
    ...updates,
  };
  const nextDetails = { ...state.sessionDetailsById };
  const existingDetail = nextDetails[activeSessionId];
  nextDetails[activeSessionId] = existingDetail
    ? {
        ...existingDetail,
        session: nextSession,
      }
    : state.activeSessionId === activeSessionId
      ? buildDetailFromState(state, nextSession)
      : emptyDetail(nextSession);

  return {
    session: state.activeSessionId === activeSessionId ? nextSession : state.session,
    sessionSummaries: syncSummary(state.sessionSummaries, nextSession),
    sessionDetailsById: nextDetails,
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
  activeSessionId: null,
  sessionSummaries: [],
  sessionDetailsById: {},
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
  contextSummary: null,
  serviceConfig: null,
  capabilities: [],
  transportFlavor: "unknown",
  runStatus: FALLBACK_RUN_STATUS,
  statusMessage: null,
  draftPrompt: "",
  isSubmitting: false,
  pendingAssistantState: null,
  activePhaseSummary: null,
  async loadTools() {
    await get().loadServiceHealth();
  },
  async loadContext(connectionId) {
    try {
      const context = await getAgentContext(connectionId ?? undefined);
      set({
        context,
      });
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
        tools: health.tools,
        statusMessage: !health.model?.enabled
          ? "Agent model is disabled"
          : !health.model?.configured
            ? "Agent service is reachable, but the model is not configured"
            : "Agent service is ready",
      });
    } catch (error) {
      set({
        capabilities: [],
        tools: [],
        statusMessage: error instanceof Error ? error.message : "Agent service is unreachable",
      });
    }
  },
  async loadServiceConfig() {
    try {
      const serviceConfig = await getAgentServiceConfig();
      set({ serviceConfig });
    } catch (error) {
      set({
        serviceConfig: null,
        statusMessage: error instanceof Error ? error.message : "Failed to load agent service config",
      });
    }
  },
  async loadSessions() {
    try {
      const result = await listAgentSessions();
      set((state) => {
        const nextDetails = { ...state.sessionDetailsById };
        for (const session of result.sessions) {
          nextDetails[session.id] = nextDetails[session.id]
            ? {
                ...nextDetails[session.id],
                session,
              }
            : emptyDetail(session);
        }

        return {
          sessionSummaries: result.sessions,
          sessionDetailsById: nextDetails,
        };
      });
    } catch (error) {
      set({
        statusMessage: error instanceof Error ? error.message : "Failed to load agent sessions",
      });
    }
  },
  async loadSessionDetail(sessionId) {
    const result = await getAgentSessionDetail(sessionId);
    const detail: AgentSessionDetail = {
      ...result.detail,
      messages: result.detail.messages.map((message) => ({
        ...message,
        isOptimistic: false,
      })),
    };

    set((state) => ({
      sessionSummaries: syncSummary(state.sessionSummaries, detail.session),
      sessionDetailsById: {
        ...state.sessionDetailsById,
        [sessionId]: detail,
      },
      ...(state.activeSessionId === sessionId ? mirrorFromDetail(detail, state) : {}),
    }));
  },
  async initializeSessionState() {
    await get().loadSessions();
    await get().createNewSession();
  },
  async createNewSession() {
    const state = get();
    const result = await createAgentSession({
      mode: state.mode,
      safetyLevel: state.safetyLevel,
    });

    const detail = emptyDetail(result.session);
    set((current) => ({
      activeSessionId: result.session.id,
      sessionSummaries: syncSummary(current.sessionSummaries, result.session),
      sessionDetailsById: {
        ...current.sessionDetailsById,
        [result.session.id]: detail,
      },
      ...mirrorFromDetail(detail, current),
      runStatus: FALLBACK_RUN_STATUS,
      pendingAssistantState: null,
      activePhaseSummary: null,
      statusMessage: current.statusMessage,
    }));

    for (const event of result.events) {
      get().applyIncomingEvent(event);
    }
  },
  async setActiveSession(sessionId) {
    const state = get();
    if (state.activeSessionId === sessionId) {
      return;
    }

    if (!state.sessionDetailsById[sessionId] || state.sessionDetailsById[sessionId].messages.length === 0) {
      await get().loadSessionDetail(sessionId);
    }

    const nextState = get();
    const detail = nextState.sessionDetailsById[sessionId];
    if (!detail) {
      return;
    }

    set((current) => ({
      activeSessionId: sessionId,
      ...mirrorFromDetail(detail, current),
      runStatus: detail.timeline.runs[0]?.status ?? "idle",
      pendingAssistantState: null,
      activePhaseSummary: null,
      isSubmitting: false,
      draftAttachments: current.draftAttachments,
      draftPrompt: current.draftPrompt,
    }));
  },
  setMode(mode) {
    set((state) => {
      return {
        mode,
        ...syncActiveSessionDraft(state, {
          draftMode: mode,
          updatedAt: nowIso(),
        }),
      };
    });
  },
  setSafetyLevel(safetyLevel) {
    set((state) => {
      return {
        safetyLevel,
        ...syncActiveSessionDraft(state, {
          draftSafetyLevel: safetyLevel,
          updatedAt: nowIso(),
        }),
      };
    });
  },
  setDraftPrompt(prompt) {
    set({ draftPrompt: prompt });
  },
  async submitDraftMessage() {
    let state = get();
    const content = state.draftPrompt.trim();
    const activeRun =
      state.timeline.activeRunId != null
        ? state.timeline.runs.find((item) => item.id === state.timeline.activeRunId) ?? null
        : state.timeline.runs[0] ?? null;

    if (!content || state.isSubmitting || !isRunTerminal(activeRun?.status ?? state.runStatus)) {
      return;
    }

    if (!state.session) {
      await get().createNewSession();
      state = get();
    }

    const createdAt = nowIso();
    const attachmentsSnapshot = [...state.draftAttachments];
    const optimisticMessageId = `local-user-${crypto.randomUUID()}`;
    const optimisticMessage: AgentThreadMessage = {
      id: optimisticMessageId,
      role: "user",
      content,
      mode: state.mode,
      safetyLevel: state.safetyLevel,
      createdAt,
      attachments: attachmentsSnapshot,
      runId: null,
      isStreaming: false,
      isOptimistic: true,
    };

    try {
      set((current) => {
        const activeSessionId = current.activeSessionId;
        const nextDetails = { ...current.sessionDetailsById };
        if (activeSessionId && current.session) {
          const currentDetail =
            nextDetails[activeSessionId] ?? buildDetailFromState(current, current.session);
          nextDetails[activeSessionId] = {
            ...currentDetail,
            messages: upsertMessage(currentDetail.messages, optimisticMessage),
          };
        }

        return {
          sessionDetailsById: nextDetails,
          messages: upsertMessage(current.messages, optimisticMessage),
          draftPrompt: "",
          draftAttachments: [],
          isSubmitting: true,
          pendingAssistantState: {
            userMessageId: optimisticMessageId,
            runId: null,
            phase: "sending",
            detail: null,
            createdAt,
          },
          activePhaseSummary: "sending",
          statusMessage: null,
        };
      });

      const session = get().session;
      if (!session) {
        throw new Error("Failed to create agent session");
      }

      await streamAgentMessage({
        sessionId: session.id,
        content,
        mode: get().mode,
        safetyLevel: get().safetyLevel,
        attachments: attachmentsSnapshot,
        onEvent: (event) => {
          get().applyIncomingEvent(event);
        },
      });

      set((current) => ({
        isSubmitting: false,
        pendingAssistantState:
          current.pendingAssistantState && current.pendingAssistantState.runId == null
            ? null
            : current.pendingAssistantState,
        activePhaseSummary:
          current.pendingAssistantState && current.pendingAssistantState.runId == null
            ? null
            : current.activePhaseSummary,
        statusMessage: current.runStatus === "failed" ? current.statusMessage : null,
      }));
    } catch (error) {
      set((current) => ({
        isSubmitting: false,
        pendingAssistantState: null,
        activePhaseSummary: null,
        statusMessage:
          error instanceof Error ? error.message : "Failed to talk to agent service",
        messages: current.messages.map((message) =>
          message.id === optimisticMessageId ? { ...message, isOptimistic: false } : message,
        ),
      }));
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
    const sessionId = get().activeSessionId;
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
      const nextDetails = { ...state.sessionDetailsById };
      const baseSession =
        (incoming.type === "session.start" ? incoming.payload.session : state.session) ??
        state.sessionSummaries.find((item) => item.id === incoming.sessionId) ??
        null;

      if (!nextDetails[incoming.sessionId]) {
        if (baseSession) {
          nextDetails[incoming.sessionId] =
            state.activeSessionId === incoming.sessionId
              ? buildDetailFromState(state, baseSession)
              : emptyDetail(baseSession);
        } else {
          const fallbackSession: AgentSessionSummary = {
            id: incoming.sessionId,
            createdAt: incoming.timestamp,
            updatedAt: incoming.timestamp,
            title: "Conversation",
            lastMessagePreview: null,
            draftMode: state.mode,
            draftSafetyLevel: state.safetyLevel,
            workspaceId: null,
          };
          nextDetails[incoming.sessionId] =
            state.activeSessionId === incoming.sessionId
              ? buildDetailFromState(state, fallbackSession)
              : emptyDetail(fallbackSession);
        }
      }

      const targetDetail = nextDetails[incoming.sessionId];
      if (targetDetail && incoming.type === "session.start") {
        nextDetails[incoming.sessionId] = {
          ...targetDetail,
          session: incoming.payload.session,
        };
      }

      const detail = nextDetails[incoming.sessionId] ?? null;
      const activeSessionId = state.activeSessionId ?? incoming.sessionId;

      const updateActive = (updatedDetail: AgentSessionDetail | null, extra: Partial<AgentStore> = {}) => ({
        sessionSummaries:
          updatedDetail != null
            ? syncSummary(state.sessionSummaries, updatedDetail.session)
            : state.sessionSummaries,
        sessionDetailsById:
          updatedDetail != null
            ? {
                ...nextDetails,
                [updatedDetail.session.id]: updatedDetail,
              }
            : nextDetails,
        activeSessionId,
        ...(updatedDetail && activeSessionId === updatedDetail.session.id
          ? mirrorFromDetail(updatedDetail, state)
          : {}),
        ...extra,
      });

      if (incoming.type === "session.start") {
        const updatedDetail = {
          ...(detail ?? emptyDetail(incoming.payload.session)),
          session: incoming.payload.session,
        };
        return updateActive(updatedDetail, {
          transportFlavor: "contract",
        });
      }

      if (!detail) {
        return state;
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
          isOptimistic: false,
        };

        const reconciledMessages = upsertMessage(detail.messages, nextMessage);
        const matchingOptimistic = detail.messages.find(
          (item) =>
            item.isOptimistic &&
            item.role === nextMessage.role &&
            item.content === nextMessage.content &&
            item.mode === nextMessage.mode &&
            item.safetyLevel === nextMessage.safetyLevel &&
            attachmentsMatch(item.attachments, nextMessage.attachments),
        );

        return updateActive(
          {
            ...detail,
            session: {
              ...detail.session,
              updatedAt: incoming.timestamp,
              lastMessagePreview: incoming.payload.content,
              draftMode: incoming.payload.mode,
              draftSafetyLevel: incoming.payload.safetyLevel,
            },
            messages: reconciledMessages,
          },
          {
            pendingAssistantState:
              matchingOptimistic && state.pendingAssistantState?.userMessageId === matchingOptimistic.id
                ? {
                    ...state.pendingAssistantState,
                    userMessageId: nextMessage.id,
                  }
                : state.pendingAssistantState,
            transportFlavor: "contract",
          },
        );
      }

      if (incoming.type === "run.started") {
        const run = incoming.payload.run;
        const currentRun = detail.timeline.runs.find((item) => item.id === run.id);
        const phase = getPendingPhaseFromRunStatus(run.status);
        return updateActive(
          {
            ...detail,
            timeline: {
              ...detail.timeline,
              activeRunId: run.id,
              runs: upsertRun(detail.timeline.runs, {
                ...(currentRun ?? {
                  ...run,
                  steps: [],
                }),
                ...run,
                steps: currentRun?.steps ?? [],
              }),
            },
          },
          {
            runStatus: run.status,
            pendingAssistantState:
              state.pendingAssistantState == null
                ? null
                : {
                    ...state.pendingAssistantState,
                    runId: run.id,
                    phase: phase ?? state.pendingAssistantState.phase,
                  },
            activePhaseSummary: phase ?? state.activePhaseSummary,
            transportFlavor: "contract",
          },
        );
      }

      if (incoming.type === "run.status") {
        const nextRuns =
          incoming.runId == null
            ? detail.timeline.runs
            : detail.timeline.runs.map((run) =>
                run.id === incoming.runId ? { ...run, status: incoming.payload.status } : run,
              );
        const phase = getPendingPhaseFromRunStatus(incoming.payload.status);
        return updateActive(
          {
            ...detail,
            timeline: {
              ...detail.timeline,
              runs: nextRuns,
            },
          },
          {
            runStatus: incoming.payload.status,
            statusMessage:
              incoming.payload.status === "failed" || incoming.payload.status === "cancelled"
                ? incoming.payload.message ?? state.statusMessage
                : state.statusMessage,
            pendingAssistantState:
              phase == null || state.pendingAssistantState == null
                ? state.pendingAssistantState
                : {
                    ...state.pendingAssistantState,
                    runId: incoming.runId ?? state.pendingAssistantState.runId,
                    phase,
                    detail: incoming.payload.message ?? state.pendingAssistantState.detail,
                  },
            activePhaseSummary: phase ?? state.activePhaseSummary,
            transportFlavor: "contract",
          },
        );
      }

      if (incoming.type === "run.completed") {
        const run = incoming.payload.run;
        const currentRun = detail.timeline.runs.find((item) => item.id === run.id);
        return updateActive(
          {
            ...detail,
            timeline: {
              ...detail.timeline,
              activeRunId: run.id,
              runs: upsertRun(detail.timeline.runs, {
                ...(currentRun ?? {
                  ...run,
                  steps: [],
                }),
                ...run,
                steps: currentRun?.steps ?? [],
              }),
            },
          },
          {
            runStatus: run.status,
            isSubmitting: false,
            pendingAssistantState: null,
            activePhaseSummary: null,
            transportFlavor: "contract",
          },
        );
      }

      if (incoming.type === "assistant.delta") {
        const existing = detail.messages.find((item) => item.id === incoming.payload.messageId);
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

        return updateActive(
          {
            ...detail,
            messages: upsertMessage(detail.messages, next),
          },
          {
            isSubmitting: false,
            pendingAssistantState: null,
            activePhaseSummary: null,
            transportFlavor: "contract",
          },
        );
      }

      if (incoming.type === "assistant.final") {
        const existing = detail.messages.find((item) => item.id === incoming.payload.messageId);
        const currentRun =
          incoming.runId == null
            ? null
            : detail.timeline.runs.find((item) => item.id === incoming.runId) ?? null;
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

        return updateActive(
          {
            ...detail,
            messages: upsertMessage(detail.messages, next),
          },
          {
            transportFlavor: "contract",
            isSubmitting: false,
            pendingAssistantState: null,
            activePhaseSummary: null,
            statusMessage: null,
            runStatus: incoming.runId == null ? state.runStatus : currentRun?.status ?? state.runStatus,
          },
        );
      }

      if (incoming.type === "plan.ready") {
        const plan: ExecutionPlanDto = incoming.payload.plan;
        const currentRun = detail.timeline.runs.find((item) => item.id === plan.runId);
        const nextRun: AgentTimelineRun =
          currentRun ?? {
            id: plan.runId,
            sessionId: incoming.sessionId,
            mode: state.mode,
            safetyLevel: state.safetyLevel,
            capabilityId: null,
            status: "planning",
            goal: plan.goal,
            createdAt: incoming.timestamp,
            startedAt: null,
            completedAt: null,
            steps: [],
          };

        return updateActive(
          {
            ...detail,
            timeline: {
              activeRunId: plan.runId,
              latestPlan: plan,
              runs: upsertRun(detail.timeline.runs, {
                ...nextRun,
                capabilityId: plan.capabilityId ?? nextRun.capabilityId,
                goal: plan.goal,
                steps: plan.steps,
              }),
            },
          },
          {
            pendingAssistantState:
              state.pendingAssistantState == null
                ? null
                : {
                    ...state.pendingAssistantState,
                    runId: plan.runId,
                    phase: "planning",
                    detail: plan.steps[0]?.title ?? plan.goal,
                  },
            activePhaseSummary: state.pendingAssistantState ? "planning" : state.activePhaseSummary,
            transportFlavor: "contract",
          },
        );
      }

      if (
        incoming.type === "plan.step.started" ||
        incoming.type === "plan.step.completed" ||
        incoming.type === "plan.step.failed"
      ) {
        const step: ExecutionStepDto = incoming.payload.step;
        const run = detail.timeline.runs.find((item) => item.id === step.runId);
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
        const phase =
          nextRunStatus === "failed"
            ? null
            : state.runStatus === "producing_artifact"
              ? "preparing"
              : "planning";

        return updateActive(
          {
            ...detail,
            timeline: {
              ...detail.timeline,
              activeRunId: step.runId,
              runs: upsertRun(detail.timeline.runs, {
                ...baseRun,
                status: nextRunStatus,
                completedAt: nextRunStatus === "completed" ? nowIso() : null,
                steps: nextSteps,
              }),
            },
          },
          {
            runStatus:
              incoming.runId == null || detail.timeline.activeRunId !== incoming.runId
                ? state.runStatus
                : mapStatusToRunState(state.runStatus === "idle" ? nextRunStatus : state.runStatus),
            pendingAssistantState:
              phase == null || state.pendingAssistantState == null
                ? state.pendingAssistantState
                : {
                    ...state.pendingAssistantState,
                    runId: step.runId,
                    phase,
                    detail: step.title,
                  },
            activePhaseSummary: phase ?? state.activePhaseSummary,
            transportFlavor: "contract",
          },
        );
      }

      if (incoming.type === "approval.requested") {
        const request: ApprovalRequestDto = incoming.payload.request;
        return updateActive(
          {
            ...detail,
            approvals: upsertApproval(detail.approvals, request),
          },
          {
            isSubmitting: false,
            pendingAssistantState:
              state.pendingAssistantState == null
                ? null
                : {
                    ...state.pendingAssistantState,
                    runId: request.runId,
                    phase: "waiting_for_approval",
                    detail: request.actionSummary ?? request.title,
                  },
            activePhaseSummary: state.pendingAssistantState
              ? "waiting_for_approval"
              : state.activePhaseSummary,
            transportFlavor: "contract",
          },
        );
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
            : detail.timeline.runs.find((item) => item.id === incoming.runId) ?? null;

        return updateActive(
          {
            ...detail,
            approvals: detail.approvals.filter((item) => item.id !== incoming.payload.requestId),
            approvalHistory: [resolution, ...detail.approvalHistory],
          },
          {
            statusMessage:
              incoming.payload.outcome === "approved"
                ? null
                : incoming.payload.outcome === "rejected"
                  ? "Approval rejected"
                  : "Approval expired",
            pendingAssistantState:
              incoming.payload.outcome === "approved" && state.pendingAssistantState != null
                ? {
                    ...state.pendingAssistantState,
                    phase: "preparing",
                    detail: null,
                  }
                : null,
            activePhaseSummary:
              incoming.payload.outcome === "approved" && state.pendingAssistantState != null
                ? "preparing"
                : null,
            transportFlavor: "contract",
            runStatus: currentRun?.status ?? state.runStatus,
          },
        );
      }

      if (incoming.type === "artifact.ready") {
        return updateActive(
          {
            ...detail,
            artifacts: upsertArtifact(detail.artifacts, incoming.payload.artifact),
          },
          {
            transportFlavor: "contract",
          },
        );
      }

      if (incoming.type === "service.error") {
        const nextRuns =
          incoming.runId == null
            ? detail.timeline.runs
            : detail.timeline.runs.map((run) =>
                run.id === incoming.runId ? { ...run, status: "failed" as const } : run,
              );
        return updateActive(
          {
            ...detail,
            timeline: {
              ...detail.timeline,
              runs: nextRuns,
            },
          },
          {
            runStatus: incoming.runId == null ? state.runStatus : "failed",
            isSubmitting: false,
            pendingAssistantState: null,
            activePhaseSummary: null,
            statusMessage: incoming.payload.message,
            transportFlavor: "contract",
          },
        );
      }

      return state;
    });
  },
  setStatusMessage(message) {
    set({ statusMessage: message });
  },
}));
