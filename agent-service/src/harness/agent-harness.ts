import { randomUUID } from "node:crypto";
import type {
  AgentArtifactDto,
  AgentAttachmentDto,
  AgentEvent,
  AgentEventEnvelope,
  AgentEventPayloadByType,
  AgentEventType,
  AgentSafetyLevel,
  AgentSessionDto,
  AgentSessionMode,
  ApprovalRequestDto,
  ExecutionPlanDto,
  ExecutionStepDto,
} from "@agent-contracts";
import type { ArtifactStore } from "../artifacts/index.js";
import type { BudgetManager } from "../budget/index.js";
import type { CapabilityRegistry } from "../capabilities/index.js";
import type { DeepAgentsAdapter } from "../integrations/deepagents-adapter.js";
import type { MemoryStore } from "../memory/index.js";
import type { ModelClient, ModelRuntimeConfig } from "../models/types.js";
import { ModelClientError } from "../models/types.js";
import { ChatModeHandler } from "../modes/chat/index.js";
import { ExecuteModeHandler } from "../modes/execute/index.js";
import type { ModeHandler } from "../modes/types.js";
import type { Logger } from "../observability/logger.js";
import type { InMemorySessionStore } from "../persistence/session-store.js";
import type { PolicyEngine } from "../policy/index.js";
import type { PromptRegistry } from "../prompts/index.js";
import type { RunScheduler } from "../scheduler/index.js";
import type { ToolRegistry, ToolRunner } from "../tools/index.js";
import type { AgentTransport } from "../transport/types.js";
import type { InMemoryTransport } from "../transport/inmemory-transport.js";
import { TypedEventBus } from "./event-bus.js";

const DEFAULT_SESSION_MODE: AgentSessionMode = "chat";
const DEFAULT_SAFETY_LEVEL: AgentSafetyLevel = "observe";

export interface CreateSessionInput {
  mode?: AgentSessionMode;
  safetyLevel?: AgentSafetyLevel;
}

export interface CreateSessionResult {
  session: AgentSessionDto;
  events: AgentEvent[];
}

export interface AppendSessionMessageInput {
  sessionId: string;
  message: string;
  attachments?: AgentAttachmentDto[];
  onEvent?: (event: AgentEvent) => void;
}

export interface AppendSessionMessageResult {
  session: AgentSessionDto;
  userMessageId: string;
  assistantMessageId: string;
  assistantContent: string;
  events: AgentEvent[];
}

export interface ResolveApprovalResult {
  session: AgentSessionDto;
  runId: string;
  requestId: string;
  outcome: "approved" | "rejected" | "expired";
  events: AgentEvent[];
}

export interface AgentHarnessDeps {
  logger: Logger;
  eventBus: TypedEventBus;
  sessionStore: InMemorySessionStore;
  transport: InMemoryTransport;
  wsTransport: AgentTransport;
  promptRegistry: PromptRegistry;
  policyEngine: PolicyEngine;
  scheduler: RunScheduler;
  budgetManager: BudgetManager;
  capabilityRegistry: CapabilityRegistry;
  memoryStore: MemoryStore;
  artifactStore: ArtifactStore;
  deepAgentsAdapter: DeepAgentsAdapter;
  modelClient: ModelClient;
  toolRegistry: ToolRegistry;
  toolRunner: ToolRunner;
}

export class AgentHarness {
  private readonly modeHandlers: Record<AgentSessionMode, ModeHandler>;
  private readonly eventCollectors = new Set<{
    events: AgentEvent[];
    onEvent?: (event: AgentEvent) => void;
  }>();
  private unsubscribeTransport?: () => void;
  private readonly pendingApprovals = new Map<
    string,
    {
      session: AgentSessionDto;
      runId: string;
      request: ApprovalRequestDto;
      message: string;
      attachments: AgentAttachmentDto[];
      suggestedTopicFilter: string;
      userMessageId: string;
      capabilityId: string;
    }
  >();

  constructor(private readonly deps: AgentHarnessDeps) {
    this.modeHandlers = {
      chat: new ChatModeHandler({
        modelClient: deps.modelClient,
        promptRegistry: deps.promptRegistry,
        eventBus: deps.eventBus,
        toolRunner: deps.toolRunner,
      }),
      execute: new ExecuteModeHandler({
        modelClient: deps.modelClient,
        promptRegistry: deps.promptRegistry,
        eventBus: deps.eventBus,
        toolRunner: deps.toolRunner,
      }),
    };
  }

  async start(): Promise<void> {
    await this.deps.transport.start();
    await this.deps.wsTransport.start();
    await this.deps.deepAgentsAdapter.initialize();
    this.deps.scheduler.start();
    this.unsubscribeTransport = this.deps.eventBus.subscribeAll((event) => {
      void this.deps.transport.publish(event).catch((error: unknown) => {
        this.deps.logger.error("failed to publish event to in-memory transport", {
          error: String(error),
        });
      });
      void this.deps.wsTransport.publish(event).catch((error: unknown) => {
        this.deps.logger.error("failed to publish event to websocket transport", {
          error: String(error),
        });
      });
    });
  }

  async stop(): Promise<void> {
    this.unsubscribeTransport?.();
    this.deps.scheduler.stop();
    await this.deps.wsTransport.stop();
    await this.deps.transport.stop();
  }

  health(): Record<string, unknown> {
    return {
      status: "ok",
      service: "agent-service",
      transport: "in-memory+ws",
      capabilities: this.deps.capabilityRegistry.list(),
      tools: this.deps.toolRegistry.list(),
      memories: this.deps.memoryStore.list().length,
      deepagentsRuntime: this.deps.deepAgentsAdapter.runtime,
      model: this.deps.modelClient.getConfigSummary(),
    };
  }

  updateModelConfig(config: ModelRuntimeConfig) {
    this.deps.modelClient.configure(config);
    return this.deps.modelClient.getConfigSummary();
  }

  listTools() {
    return this.deps.toolRegistry.list();
  }

  createSession(input: CreateSessionInput = {}): CreateSessionResult {
    const mode = input.mode ?? DEFAULT_SESSION_MODE;
    const safetyLevel = input.safetyLevel ?? DEFAULT_SAFETY_LEVEL;

    return this.captureEventsSync(() => {
      const decision = this.deps.policyEngine.canStartSession(mode, safetyLevel);
      if (!decision.allowed) {
        throw new Error(
          decision.reason ?? `Session rejected by policy: mode=${mode} safetyLevel=${safetyLevel}`,
        );
      }

      const session = this.deps.sessionStore.create(mode, safetyLevel);
      this.deps.scheduler.schedule({
        id: `session-${session.id}`,
        sessionId: session.id,
        capabilityId: "session.start",
        input: {
          mode,
          safetyLevel,
        },
      });
      this.deps.logger.info("session created", {
        sessionId: session.id,
        mode,
        safetyLevel,
      });
      this.emitEvent("session.start", session.id, null, { session });
      return session;
    });
  }

  getSession(sessionId: string): AgentSessionDto | null {
    return this.deps.sessionStore.getById(sessionId);
  }

  async appendSessionMessage(input: AppendSessionMessageInput): Promise<AppendSessionMessageResult> {
    return this.captureMessageEvents(async () => {
      const session = this.deps.sessionStore.getById(input.sessionId);
      if (!session) {
        throw new Error(`Session not found: ${input.sessionId}`);
      }
      if (!this.deps.budgetManager.canRun(session.id)) {
        throw new Error(`Budget check failed for session: ${session.id}`);
      }

      const userMessageId = randomUUID();
      const capabilityMatch = await this.deps.capabilityRegistry.resolveWithFallback(
        session.mode,
        input.message,
      );
      const capability = capabilityMatch.capability;
      this.deps.logger.info("message accepted", {
        sessionId: session.id,
        mode: session.mode,
        safetyLevel: session.safetyLevel,
        capabilityId: capability.id,
        capabilityConfidence: capabilityMatch.confidence,
        capabilityReason: capabilityMatch.matchReason,
      });
      this.emitEvent("session.message", session.id, null, {
        messageId: userMessageId,
        role: "user",
        content: input.message,
        mode: session.mode,
        safetyLevel: session.safetyLevel,
        attachments: input.attachments ?? [],
      });

      const assistantMessageId = randomUUID();
      let streamedContent = "";
      try {
        if (session.mode === "execute") {
          return this.handleExecuteMode(
            session,
            input.message,
            input.attachments ?? [],
            userMessageId,
            capability.id,
          );
        }

        const assistantContent = await this.modeHandlers.chat.respond({
          session,
          message: input.message,
          attachments: input.attachments ?? [],
          capabilityId: capability.id,
          eventBus: this.deps.eventBus,
          toolRunner: this.deps.toolRunner,
          onDelta: (delta) => {
            streamedContent += delta;
            this.emitEvent("assistant.delta", session.id, null, {
              messageId: assistantMessageId,
              delta,
            });
          },
        });
        this.emitEvent("assistant.final", session.id, null, {
          messageId: assistantMessageId,
          content: assistantContent,
          finishReason: "stop",
        });

        return {
          session,
          userMessageId,
          assistantMessageId,
          assistantContent,
        };
      } catch (error) {
        const message = streamedContent || toModelErrorMessage(error);
        this.emitServiceError(session.id, null, error);
        this.emitEvent("assistant.final", session.id, null, {
          messageId: assistantMessageId,
          content: message,
          finishReason: "error",
        });
        return {
          session,
          userMessageId,
          assistantMessageId,
          assistantContent: message,
        };
      }
    }, input.onEvent);
  }

  private async handleExecuteMode(
    session: AgentSessionDto,
    message: string,
    attachments: AgentAttachmentDto[],
    userMessageId: string,
    capabilityId: string,
  ): Promise<Omit<AppendSessionMessageResult, "events">> {
    const runId = randomUUID();
    const suggestedTopicFilter = inferSuggestedTopicFilter(message);
    const plan = createParserPlan(runId, message);
    this.deps.logger.info("run started", {
      sessionId: session.id,
      runId,
      mode: session.mode,
      safetyLevel: session.safetyLevel,
      capabilityId,
    });

    this.emitEvent("plan.ready", session.id, runId, { plan });

    for (const step of plan.steps) {
      const startedStep = {
        ...step,
        status: "running",
        attempt: 1,
        startedAt: new Date().toISOString(),
      } satisfies ExecutionStepDto;
      this.emitEvent("plan.step.started", session.id, runId, {
        step: startedStep,
      });

      const completedStep = {
        ...startedStep,
        status: "completed",
        completedAt: new Date().toISOString(),
      } satisfies ExecutionStepDto;
      this.emitEvent("plan.step.completed", session.id, runId, {
        step: completedStep,
      });
    }

    if (session.safetyLevel === "confirm") {
      const request = createApprovalRequest(runId, suggestedTopicFilter, message, session.safetyLevel);
      this.pendingApprovals.set(request.id, {
        session,
        runId,
        request,
        message,
        attachments,
        suggestedTopicFilter,
        userMessageId,
        capabilityId,
      });
      this.deps.logger.info("approval requested", {
        sessionId: session.id,
        runId,
        capabilityId,
        requestId: request.id,
      });
      this.emitEvent("approval.requested", session.id, runId, { request });

      const assistantMessageId = randomUUID();
      const assistantContent = "Awaiting approval to create the parser draft artifact.";
      this.emitEvent("assistant.final", session.id, runId, {
        messageId: assistantMessageId,
        content: assistantContent,
        finishReason: "stop",
      });

      return {
        session,
        userMessageId,
        assistantMessageId,
        assistantContent,
      };
    }

    return this.completeParserAuthoring({
      session,
      runId,
      userMessageId,
      message,
      attachments,
      suggestedTopicFilter,
      capabilityId,
    });
  }

  private async captureMessageEvents(
    action: () => Promise<Omit<AppendSessionMessageResult, "events">>,
    onEvent?: (event: AgentEvent) => void,
  ): Promise<AppendSessionMessageResult> {
    const events: AgentEvent[] = [];
    const collector = { events, onEvent };
    this.eventCollectors.add(collector);
    try {
      const result = await action();
      return {
        ...result,
        events,
      };
    } finally {
      this.eventCollectors.delete(collector);
    }
  }

  async resolveApproval(
    sessionId: string,
    requestId: string,
    outcome: "approved" | "rejected" | "expired",
  ): Promise<ResolveApprovalResult> {
    return this.captureApprovalEvents(async () => {
      const pending = this.pendingApprovals.get(requestId);
      if (!pending || pending.session.id !== sessionId) {
        throw new Error(`Approval request not found: ${requestId}`);
      }

      this.pendingApprovals.delete(requestId);
      this.deps.logger.info("approval resolved", {
        sessionId,
        runId: pending.runId,
        requestId,
        outcome,
      });
      this.emitEvent("approval.resolved", sessionId, pending.runId, {
        requestId,
        outcome,
        resolvedAt: new Date().toISOString(),
        resolver: "frontend-shell",
      });

      if (outcome === "approved") {
        await this.completeParserAuthoring({
          session: pending.session,
          runId: pending.runId,
          userMessageId: pending.userMessageId,
          message: pending.message,
          attachments: pending.attachments,
          suggestedTopicFilter: pending.suggestedTopicFilter,
          capabilityId: pending.capabilityId,
        });
      } else {
        const assistantMessageId = randomUUID();
        const content =
          outcome === "rejected"
            ? "Parser draft creation was rejected."
            : "Parser draft approval expired.";
        this.emitEvent("assistant.final", sessionId, pending.runId, {
          messageId: assistantMessageId,
          content,
          finishReason: "error",
        });
      }

      return {
        session: pending.session,
        runId: pending.runId,
        requestId,
        outcome,
      };
    });
  }

  private async completeParserAuthoring(input: {
    session: AgentSessionDto;
    runId: string;
    userMessageId: string;
    message: string;
    attachments: AgentAttachmentDto[];
    suggestedTopicFilter: string;
    capabilityId: string;
  }): Promise<Omit<AppendSessionMessageResult, "events">> {
    const artifact = this.deps.artifactStore.save(
      createParserArtifact(
        input.runId,
        input.message,
        input.suggestedTopicFilter,
        input.attachments.length,
      ),
    );
    this.emitEvent("artifact.ready", input.session.id, input.runId, { artifact });

    let assistantContent: string;
    let modelFailed = false;
    const assistantMessageId = randomUUID();
    let streamedContent = "";
    try {
      assistantContent = await this.modeHandlers.execute.respond({
        session: input.session,
        message: buildExecutePrompt(input.message, input.suggestedTopicFilter, artifact),
        attachments: input.attachments,
        capabilityId: input.capabilityId,
        runId: input.runId,
        eventBus: this.deps.eventBus,
        toolRunner: this.deps.toolRunner,
        onDelta: (delta) => {
          streamedContent += delta;
          this.emitEvent("assistant.delta", input.session.id, input.runId, {
            messageId: assistantMessageId,
            delta,
          });
        },
      });
    } catch (error) {
      modelFailed = true;
      assistantContent = streamedContent || toModelErrorMessage(error);
      this.emitServiceError(input.session.id, input.runId, error);
    }

    this.emitEvent("assistant.final", input.session.id, input.runId, {
      messageId: assistantMessageId,
      content: assistantContent,
      finishReason: modelFailed ? "error" : "stop",
    });
    this.deps.logger.info("run completed", {
      sessionId: input.session.id,
      runId: input.runId,
      capabilityId: input.capabilityId,
      safetyLevel: input.session.safetyLevel,
      finishReason: modelFailed ? "error" : "stop",
    });

    return {
      session: input.session,
      userMessageId: input.userMessageId,
      assistantMessageId,
      assistantContent,
    };
  }

  private async captureApprovalEvents(
    action: () => Promise<Omit<ResolveApprovalResult, "events">>,
  ): Promise<ResolveApprovalResult> {
    const events: AgentEvent[] = [];
    const collector = { events };
    this.eventCollectors.add(collector);
    try {
      const result = await action();
      return {
        ...result,
        events,
      };
    } finally {
      this.eventCollectors.delete(collector);
    }
  }

  private captureEventsSync<T>(action: () => T): { session: T; events: AgentEvent[] } {
    const events: AgentEvent[] = [];
    const collector = { events };
    this.eventCollectors.add(collector);
    try {
      const session = action();
      return {
        session,
        events,
      };
    } finally {
      this.eventCollectors.delete(collector);
    }
  }

  private emitEvent<TType extends AgentEventType>(
    type: TType,
    sessionId: string,
    runId: string | null,
    payload: AgentEventPayloadByType[TType],
  ): void {
    const event = {
      id: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      sessionId,
      runId,
      payload,
    } as AgentEventEnvelope<TType> as AgentEvent;

    for (const collector of this.eventCollectors) {
      collector.events.push(event);
      collector.onEvent?.(event);
    }

    this.deps.eventBus.publish(event);
  }

  private emitServiceError(sessionId: string, runId: string | null, error: unknown) {
    this.emitEvent("service.error", sessionId, runId, {
      code: error instanceof ModelClientError ? error.code : "service_error",
      message: toModelErrorMessage(error),
      recoverable: error instanceof ModelClientError ? error.recoverable : true,
      details: null,
    });
  }
}

function createParserPlan(runId: string, goal: string): ExecutionPlanDto {
  return {
    runId,
    capabilityId: "parser-authoring",
    goal,
    steps: [
      createPlanStep(runId, 0, "Inspect parser request", "planning"),
      createPlanStep(runId, 1, "Build parser draft", "artifact"),
      createPlanStep(runId, 2, "Prepare parser artifact", "artifact"),
    ],
  };
}

function createPlanStep(
  runId: string,
  index: number,
  title: string,
  kind: string,
): ExecutionStepDto {
  return {
    id: randomUUID(),
    runId,
    index,
    title,
    kind,
    status: "pending",
    toolName: null,
    attempt: 0,
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

function inferSuggestedTopicFilter(message: string) {
  const directTopic =
    message.match(/(?:topic|主题)\s*[:：]\s*([A-Za-z0-9/_#+-]+)/i)?.[1] ??
    message.match(/\b([A-Za-z0-9_-]+\/[A-Za-z0-9/_#+-]+)\b/)?.[1];

  return directTopic?.trim() || "telemetry/raw";
}

function toParserName(topicFilter: string) {
  return topicFilter
    .split(/[\/_-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
    .concat(" Parser");
}

function createParserArtifact(
  runId: string,
  request: string,
  topicFilter: string,
  attachmentCount: number,
): AgentArtifactDto {
  const name = toParserName(topicFilter);
  const notes =
    attachmentCount > 0
      ? `Generated from execute mode with ${attachmentCount} image attachment(s).`
      : "Generated from execute mode without attachments.";

  const script = `function parse(input, helpers) {
  const bytes = helpers.hexToBytes(input.payloadHex);

  return {
    topic: input.topic,
    topicFilter: "${topicFilter}",
    payloadHex: input.payloadHex,
    payloadSize: input.payloadSize,
    byteLength: bytes.length,
    requestSummary: ${JSON.stringify(request.trim().slice(0, 120))},
  };
}`;

  return {
    id: randomUUID(),
    runId,
    capabilityId: "parser-authoring",
    type: "parser-script",
    schemaVersion: 1,
    title: name,
    summary: `Parser draft for ${topicFilter}`,
    payload: {
      name,
      script,
      notes,
      suggestedTopicFilter: topicFilter,
      sourceSampleSummary: request.trim().slice(0, 120),
    },
    createdAt: new Date().toISOString(),
  };
}

function buildExecutePrompt(
  request: string,
  topicFilter: string,
  artifact: AgentArtifactDto,
) {
  return `Generate a concise execute-mode summary for parser authoring.\nRequest: ${request}\nSuggested topic filter: ${topicFilter}\nArtifact title: ${artifact.title}`;
}

function createApprovalRequest(
  runId: string,
  topicFilter: string,
  request: string,
  safetyLevel: AgentSafetyLevel,
): ApprovalRequestDto {
  return {
    id: randomUUID(),
    runId,
    stepId: null,
    toolName: "artifact.createParserDraft",
    title: "Approve parser draft creation",
    actionSummary: `Create a parser draft artifact for ${topicFilter}`,
    reason: request.trim().slice(0, 160) || "Execute mode requires confirmation before producing the parser draft artifact.",
    riskLevel: "medium",
    safetyLevel,
    inputPreview: JSON.stringify(
      {
        suggestedTopicFilter: topicFilter,
        request: request.trim().slice(0, 200),
      },
      null,
      2,
    ),
    requestedAt: new Date().toISOString(),
    expiresAt: null,
  };
}

function toModelErrorMessage(error: unknown) {
  if (error instanceof ModelClientError) {
    return error.message;
  }

  return error instanceof Error ? error.message : "Agent request failed";
}
