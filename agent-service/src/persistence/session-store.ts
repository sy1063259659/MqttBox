import { randomUUID } from "node:crypto";
import type {
  AgentArtifactDto,
  AgentEvent,
  AgentEventEnvelope,
  AgentSafetyLevel,
  AgentSessionContextSummaryDto,
  AgentSessionDetailDto,
  AgentSessionDto,
  AgentSessionMode,
  AgentThreadMessageDto,
  ApprovalRequestDto,
  ApprovalResolutionRecordDto,
  ExecutionPlanDto,
  ExecutionStepDto,
} from "@agent-contracts";
import { loadJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

const SESSION_STORE_FILE = "sessions.json";
const CONTEXT_SUMMARY_MAX_MESSAGES = 14;
const CONTEXT_SUMMARY_MAX_CHARS = 12000;
const CONTEXT_SUMMARY_RECENT_WINDOW = 8;

interface PersistedSessionStoreShape {
  sessions: AgentSessionDetailDto[];
}

export class InMemorySessionStore {
  private readonly sessions = new Map<string, AgentSessionDetailDto>();

  constructor() {
    const persisted = loadJsonFile<PersistedSessionStoreShape>(SESSION_STORE_FILE, {
      sessions: [],
    });

    for (const detail of persisted.sessions ?? []) {
      this.sessions.set(detail.session.id, normalizeDetail(detail));
    }
  }

  create(draftMode: AgentSessionMode, draftSafetyLevel: AgentSafetyLevel): AgentSessionDetailDto {
    const createdAt = new Date().toISOString();
    const detail: AgentSessionDetailDto = {
      session: {
        id: randomUUID(),
        createdAt,
        updatedAt: createdAt,
        title: "New conversation",
        lastMessagePreview: null,
        draftMode,
        draftSafetyLevel,
        workspaceId: null,
      },
      timeline: {
        activeRunId: null,
        runs: [],
        latestPlan: null,
      },
      messages: [],
      approvals: [],
      approvalHistory: [],
      artifacts: [],
      contextSummary: null,
    };

    this.sessions.set(detail.session.id, detail);
    this.flush();
    return cloneDetail(detail);
  }

  list(): AgentSessionDto[] {
    return [...this.sessions.values()]
      .map((detail) => cloneSession(detail.session))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getById(sessionId: string): AgentSessionDto | null {
    return this.sessions.get(sessionId)?.session
      ? cloneSession(this.sessions.get(sessionId)!.session)
      : null;
  }

  getDetail(sessionId: string): AgentSessionDetailDto | null {
    const detail = this.sessions.get(sessionId);
    return detail ? cloneDetail(detail) : null;
  }

  applyEvent(event: AgentEvent): AgentSessionDetailDto | null {
    const detail = this.sessions.get(event.sessionId);
    if (!detail) {
      return null;
    }

    const nextDetail = reduceDetailWithEvent(detail, event);
    nextDetail.contextSummary = buildContextSummary(nextDetail);
    this.sessions.set(event.sessionId, nextDetail);
    if (event.type !== "assistant.delta") {
      this.flush();
    }
    return cloneDetail(nextDetail);
  }

  updateDraftPreferences(
    sessionId: string,
    draftMode: AgentSessionMode,
    draftSafetyLevel: AgentSafetyLevel,
  ): AgentSessionDto | null {
    const detail = this.sessions.get(sessionId);
    if (!detail) {
      return null;
    }

    const updatedAt = new Date().toISOString();
    const nextDetail: AgentSessionDetailDto = {
      ...detail,
      session: {
        ...detail.session,
        draftMode,
        draftSafetyLevel,
        updatedAt,
      },
    };
    this.sessions.set(sessionId, nextDetail);
    this.flush();
    return cloneSession(nextDetail.session);
  }

  private flush(): void {
    writeJsonFileAtomic(SESSION_STORE_FILE, {
      sessions: [...this.sessions.values()],
    } satisfies PersistedSessionStoreShape);
  }
}

function reduceDetailWithEvent(detail: AgentSessionDetailDto, event: AgentEvent): AgentSessionDetailDto {
  const updatedAt = event.timestamp;
  const nextSession = {
    ...detail.session,
    updatedAt,
  };

  if (event.type === "session.start") {
    return {
      ...detail,
      session: {
        ...nextSession,
        ...event.payload.session,
        updatedAt,
      },
    };
  }

  if (event.type === "session.message") {
    const message: AgentThreadMessageDto = {
      id: event.payload.messageId,
      role: event.payload.role,
      content: event.payload.content,
      mode: event.payload.mode,
      safetyLevel: event.payload.safetyLevel,
      createdAt: event.timestamp,
      attachments: event.payload.attachments ?? [],
      runId: event.runId ?? null,
      isStreaming: false,
    };

    const messages = upsertMessage(detail.messages, message);
    return {
      ...detail,
      session: {
        ...nextSession,
        title: deriveSessionTitle(messages, detail.session.title),
        lastMessagePreview: buildPreview(message.content),
        draftMode: message.mode,
        draftSafetyLevel: message.safetyLevel,
      },
      messages,
    };
  }

  if (event.type === "assistant.delta") {
    const existing = detail.messages.find((message) => message.id === event.payload.messageId);
    const nextMessage: AgentThreadMessageDto = existing
      ? {
          ...existing,
          content: `${existing.content}${event.payload.delta}`,
          isStreaming: true,
        }
      : {
          id: event.payload.messageId,
          role: "assistant",
          content: event.payload.delta,
          mode: detail.session.draftMode,
          safetyLevel: detail.session.draftSafetyLevel,
          createdAt: event.timestamp,
          attachments: [],
          runId: event.runId ?? null,
          isStreaming: true,
        };

    return {
      ...detail,
      session: {
        ...nextSession,
        lastMessagePreview: buildPreview(nextMessage.content),
      },
      messages: upsertMessage(detail.messages, nextMessage),
    };
  }

  if (event.type === "assistant.final") {
    const existing = detail.messages.find((message) => message.id === event.payload.messageId);
    const nextMessage: AgentThreadMessageDto = existing
      ? {
          ...existing,
          content: event.payload.content,
          isStreaming: false,
        }
      : {
          id: event.payload.messageId,
          role: "assistant",
          content: event.payload.content,
          mode: detail.session.draftMode,
          safetyLevel: detail.session.draftSafetyLevel,
          createdAt: event.timestamp,
          attachments: [],
          runId: event.runId ?? null,
          isStreaming: false,
        };

    const messages = upsertMessage(detail.messages, nextMessage);
    return {
      ...detail,
      session: {
        ...nextSession,
        title: deriveSessionTitle(messages, detail.session.title),
        lastMessagePreview: buildPreview(nextMessage.content),
      },
      messages,
    };
  }

  if (event.type === "run.started" || event.type === "run.completed") {
    const nextRun = {
      ...event.payload.run,
      steps:
        detail.timeline.runs.find((run) => run.id === event.payload.run.id)?.steps ?? [],
    };

    return {
      ...detail,
      timeline: {
        ...detail.timeline,
        activeRunId: event.payload.run.id,
        runs: upsertRun(detail.timeline.runs, nextRun),
      },
      session: nextSession,
    };
  }

  if (event.type === "run.status") {
    return {
      ...detail,
      timeline: {
        ...detail.timeline,
        runs:
          event.runId == null
            ? detail.timeline.runs
            : detail.timeline.runs.map((run) =>
                run.id === event.runId ? { ...run, status: event.payload.status } : run,
              ),
      },
      session: nextSession,
    };
  }

  if (event.type === "plan.ready") {
    const currentRun = detail.timeline.runs.find((run) => run.id === event.payload.plan.runId);
    return {
      ...detail,
      timeline: {
        activeRunId: event.payload.plan.runId,
        latestPlan: event.payload.plan,
        runs: upsertRun(detail.timeline.runs, {
          ...(currentRun ?? {
            id: event.payload.plan.runId,
            sessionId: event.sessionId,
            mode: detail.session.draftMode,
            safetyLevel: detail.session.draftSafetyLevel,
            capabilityId: event.payload.plan.capabilityId,
            status: "planning",
            goal: event.payload.plan.goal,
            createdAt: event.timestamp,
            startedAt: event.timestamp,
            completedAt: null,
            steps: [],
          }),
          capabilityId: event.payload.plan.capabilityId,
          goal: event.payload.plan.goal,
          steps: event.payload.plan.steps,
        }),
      },
      session: nextSession,
    };
  }

  if (
    event.type === "plan.step.started" ||
    event.type === "plan.step.completed" ||
    event.type === "plan.step.failed"
  ) {
    return {
      ...detail,
      timeline: {
        ...detail.timeline,
        activeRunId: event.payload.step.runId,
        runs: detail.timeline.runs.map((run) =>
          run.id === event.payload.step.runId
            ? {
                ...run,
                steps: upsertStep(run.steps, event.payload.step),
              }
            : run,
        ),
      },
      session: nextSession,
    };
  }

  if (event.type === "approval.requested") {
    return {
      ...detail,
      approvals: upsertApproval(detail.approvals, event.payload.request),
      session: nextSession,
    };
  }

  if (event.type === "approval.resolved") {
    const resolution: ApprovalResolutionRecordDto = {
      requestId: event.payload.requestId,
      outcome: event.payload.outcome,
      resolvedAt: event.payload.resolvedAt,
      resolver: event.payload.resolver,
    };

    return {
      ...detail,
      approvals: detail.approvals.filter((item) => item.id !== event.payload.requestId),
      approvalHistory: upsertApprovalResolution(detail.approvalHistory, resolution),
      session: nextSession,
    };
  }

  if (event.type === "artifact.ready") {
    return {
      ...detail,
      artifacts: upsertArtifact(detail.artifacts, event.payload.artifact),
      session: nextSession,
    };
  }

  return {
    ...detail,
    session: nextSession,
  };
}

function buildContextSummary(detail: AgentSessionDetailDto): AgentSessionContextSummaryDto | null {
  const messageChars = detail.messages.reduce((total, message) => total + message.content.length, 0);
  if (
    detail.messages.length <= CONTEXT_SUMMARY_MAX_MESSAGES &&
    messageChars <= CONTEXT_SUMMARY_MAX_CHARS
  ) {
    return null;
  }

  const preservedMessages = detail.messages.slice(-CONTEXT_SUMMARY_RECENT_WINDOW);
  const compressedMessages = detail.messages.slice(0, Math.max(0, detail.messages.length - preservedMessages.length));
  const lines: string[] = [];

  const firstUser = detail.messages.find((message) => message.role === "user");
  if (firstUser?.content.trim()) {
    lines.push(`Goal: ${buildPreview(firstUser.content, 220)}`);
  }

  const latestAssistant = [...detail.messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.content.trim().length > 0);
  if (latestAssistant?.content.trim()) {
    lines.push(`Latest conclusion: ${buildPreview(latestAssistant.content, 260)}`);
  }

  const recentArtifact = detail.artifacts[0];
  if (recentArtifact) {
    lines.push(`Latest artifact: ${recentArtifact.title} — ${buildPreview(recentArtifact.summary, 180)}`);
  }

  if (detail.approvals.length > 0) {
    lines.push(
      `Pending approvals: ${detail.approvals
        .slice(0, 2)
        .map((request) => buildPreview(request.actionSummary, 120))
        .join("; ")}`,
    );
  }

  const completedRuns = detail.timeline.runs.filter((run) => run.completedAt);
  if (completedRuns.length > 0) {
    lines.push(
      `Completed runs: ${completedRuns
        .slice(0, 3)
        .map((run) => `${run.mode}/${run.capabilityId ?? "unknown"} (${run.status})`)
        .join(", ")}`,
    );
  }

  const compressedPreview = compressedMessages
    .slice(-6)
    .map((message) => `${message.role}: ${buildPreview(message.content, 140)}`)
    .join("\n");

  if (compressedPreview) {
    lines.push("Compressed history:");
    lines.push(compressedPreview);
  }

  return {
    content: lines.join("\n"),
    updatedAt: detail.session.updatedAt,
    sourceMessageCount: compressedMessages.length,
    compressedUntil: preservedMessages[0]?.createdAt ?? null,
  };
}

function normalizeDetail(detail: AgentSessionDetailDto): AgentSessionDetailDto {
  return {
    session: {
      ...detail.session,
      updatedAt: detail.session.updatedAt ?? detail.session.createdAt,
      title: detail.session.title?.trim() || "New conversation",
      lastMessagePreview: detail.session.lastMessagePreview ?? null,
      draftMode: detail.session.draftMode ?? "chat",
      draftSafetyLevel: detail.session.draftSafetyLevel ?? "confirm",
      workspaceId: detail.session.workspaceId ?? null,
    },
    timeline: {
      activeRunId: detail.timeline?.activeRunId ?? null,
      runs: (detail.timeline?.runs ?? []).map((run) => ({
        ...run,
        steps: run.steps ?? [],
      })),
      latestPlan: detail.timeline?.latestPlan ?? null,
    },
    messages: detail.messages ?? [],
    approvals: detail.approvals ?? [],
    approvalHistory: detail.approvalHistory ?? [],
    artifacts: detail.artifacts ?? [],
    contextSummary: detail.contextSummary ?? null,
  };
}

function deriveSessionTitle(messages: AgentThreadMessageDto[], fallback: string) {
  const candidate = messages.find((message) => message.role === "user" && message.content.trim().length > 0);
  return candidate ? buildPreview(candidate.content, 48) ?? fallback : fallback;
}

function buildPreview(content: string | null | undefined, maxLength = 80) {
  const normalized = (content ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function upsertMessage(messages: AgentThreadMessageDto[], nextMessage: AgentThreadMessageDto) {
  const index = messages.findIndex((message) => message.id === nextMessage.id);
  if (index < 0) {
    return [...messages, nextMessage];
  }

  const next = [...messages];
  next[index] = nextMessage;
  return next;
}

function upsertRun(
  runs: Array<AgentSessionDetailDto["timeline"]["runs"][number]>,
  nextRun: AgentSessionDetailDto["timeline"]["runs"][number],
) {
  const index = runs.findIndex((run) => run.id === nextRun.id);
  if (index < 0) {
    return [nextRun, ...runs];
  }

  const next = [...runs];
  next[index] = nextRun;
  return next;
}

function upsertStep(steps: ExecutionStepDto[], nextStep: ExecutionStepDto) {
  const index = steps.findIndex((step) => step.id === nextStep.id);
  if (index < 0) {
    return [...steps, nextStep];
  }

  const next = [...steps];
  next[index] = nextStep;
  return next;
}

function upsertApproval(approvals: ApprovalRequestDto[], nextApproval: ApprovalRequestDto) {
  const index = approvals.findIndex((approval) => approval.id === nextApproval.id);
  if (index < 0) {
    return [nextApproval, ...approvals];
  }

  const next = [...approvals];
  next[index] = nextApproval;
  return next;
}

function upsertApprovalResolution(
  history: ApprovalResolutionRecordDto[],
  nextResolution: ApprovalResolutionRecordDto,
) {
  const index = history.findIndex((item) => item.requestId === nextResolution.requestId);
  if (index < 0) {
    return [nextResolution, ...history];
  }

  const next = [...history];
  next[index] = nextResolution;
  return next;
}

function upsertArtifact(artifacts: AgentArtifactDto[], nextArtifact: AgentArtifactDto) {
  const index = artifacts.findIndex((artifact) => artifact.id === nextArtifact.id);
  if (index < 0) {
    return [nextArtifact, ...artifacts];
  }

  const next = [...artifacts];
  next[index] = nextArtifact;
  return next;
}

function cloneSession(session: AgentSessionDto): AgentSessionDto {
  return JSON.parse(JSON.stringify(session)) as AgentSessionDto;
}

function cloneDetail(detail: AgentSessionDetailDto): AgentSessionDetailDto {
  return JSON.parse(JSON.stringify(detail)) as AgentSessionDetailDto;
}
