import { randomUUID } from "node:crypto";
import type {
  AgentAttachmentDto,
  AgentEvent,
  AgentEventEnvelope,
  AgentEventPayloadByType,
  AgentEventType,
  AgentServiceConfigDto,
  AgentSafetyLevel,
  AgentSessionDto,
  AgentSessionMode,
  ApprovalRequestDto,
  ExecutionStepDto,
} from "@agent-contracts";
import type { ArtifactStore } from "../artifacts/index.js";
import type { BudgetManager } from "../budget/index.js";
import type { CapabilityRegistry } from "../capabilities/index.js";
import {
  PARSER_AUTHORING_ATTACHMENT_POLICY,
  ParserAuthoringHandler,
  type ParserAuthoringHandlerContract,
} from "../capabilities/parser-authoring.js";
import type {
  DeepAgentsAdapter,
  DeepAgentsExecuteResult,
} from "../integrations/deepagents-adapter.js";
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
  private readonly parserAuthoringHandler: ParserAuthoringHandlerContract;
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
      threadId: string;
      message: string;
      attachments: AgentAttachmentDto[];
      suggestedTopicFilter: string;
      userMessageId: string;
      capabilityId: string;
      startedAt: string;
    }
  >();

  constructor(private readonly deps: AgentHarnessDeps) {
    this.parserAuthoringHandler = new ParserAuthoringHandler();
    this.modeHandlers = {
      chat: new ChatModeHandler({
        modelClient: deps.modelClient,
        promptRegistry: deps.promptRegistry,
        eventBus: deps.eventBus,
        toolRegistry: deps.toolRegistry,
        toolRunner: deps.toolRunner,
        deepAgentsAdapter: deps.deepAgentsAdapter,
      }),
      execute: new ExecuteModeHandler({
        modelClient: deps.modelClient,
        promptRegistry: deps.promptRegistry,
        eventBus: deps.eventBus,
        toolRegistry: deps.toolRegistry,
        toolRunner: deps.toolRunner,
        deepAgentsAdapter: deps.deepAgentsAdapter,
      }),
    };
  }

  async start(): Promise<void> {
    await this.deps.transport.start();
    await this.deps.wsTransport.start();
    await this.deps.deepAgentsAdapter.initialize();
    this.deps.scheduler.start();
    this.unsubscribeTransport = this.deps.eventBus.subscribeAll((event) => {
      for (const collector of this.eventCollectors) {
        collector.events.push(event);
        collector.onEvent?.(event);
      }
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

  getConfig(): AgentServiceConfigDto {
    const capabilities = this.deps.capabilityRegistry.list();
    return {
      service: "agent-service",
      model: this.deps.modelClient.getConfigSummary(),
      transport: {
        modes: ["in-memory", "ws"],
      },
      runtime: {
        deepagentsRuntime: this.deps.deepAgentsAdapter.runtime,
      },
      supportsImageInput: true,
      supportsParserAuthoring: capabilities.some((capability) => capability.id === "parser-authoring"),
      supportsApproval: true,
      maxAttachmentCount: PARSER_AUTHORING_ATTACHMENT_POLICY.maxAttachmentCount,
      maxAttachmentBytes: PARSER_AUTHORING_ATTACHMENT_POLICY.maxAttachmentBytes,
      acceptedImageMimeTypes: [...PARSER_AUTHORING_ATTACHMENT_POLICY.acceptedImageMimeTypes],
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

        const response = await this.modeHandlers.chat.respond({
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
        const assistantContent = response.assistantText;
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
    const startedAt = new Date().toISOString();
    const suggestedTopicFilter = this.parserAuthoringHandler.inferSuggestedTopicFilter(message);
    const plan = this.parserAuthoringHandler.createPlan(runId, message);
    this.emitEvent("run.started", session.id, runId, {
      run: this.parserAuthoringHandler.createRun({
        session,
        runId,
        goal: message,
        capabilityId,
        status: "planning",
        startedAt,
      }),
    });
    this.deps.logger.info("run started", {
      sessionId: session.id,
      runId,
      mode: session.mode,
      safetyLevel: session.safetyLevel,
      capabilityId,
    });

    this.emitEvent("plan.ready", session.id, runId, { plan });
    this.emitEvent("run.status", session.id, runId, {
      runId,
      status: "planning",
      message: "Execution plan ready",
    });

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

    return this.completeParserAuthoring({
      session,
      runId,
      userMessageId,
      message,
      attachments,
      suggestedTopicFilter,
      capabilityId,
      startedAt,
      resumeThreadId: null,
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
        throw new AgentHarnessHttpError(
          410,
          "approval_request_expired",
          "Approval expired after agent-service restart or timeout. Please rerun the task.",
          { requestId },
        );
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
          startedAt: pending.startedAt,
          resumeThreadId: pending.threadId,
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
        const completedAt = new Date().toISOString();
        this.emitEvent("run.completed", sessionId, pending.runId, {
          run: this.parserAuthoringHandler.createRun({
            session: pending.session,
            runId: pending.runId,
            goal: pending.message,
            capabilityId: pending.capabilityId,
            status: "failed",
            startedAt: pending.startedAt,
            completedAt,
          }),
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
    startedAt: string;
    resumeThreadId: string | null;
  }): Promise<Omit<AppendSessionMessageResult, "events">> {
    this.emitEvent("run.status", input.session.id, input.runId, {
      runId: input.runId,
      status: "producing_artifact",
      message: "Generating parser draft artifact",
    });
    this.emitEvent("run.status", input.session.id, input.runId, {
      runId: input.runId,
      status: "running",
      message: "Executing parser authoring runtime",
    });

    let assistantContent: string;
    let modelFailed = false;
    const assistantMessageId = randomUUID();
    let streamedContent = "";
    let executeResult: DeepAgentsExecuteResult;
    try {
      if (input.resumeThreadId) {
        executeResult = await this.deps.deepAgentsAdapter.resumeExecute({
          sessionId: input.session.id,
          runId: input.runId,
          threadId: input.resumeThreadId,
          systemPrompt: this.deps.promptRegistry.getSystemPrompt("execute", input.capabilityId),
          userMessage: input.message,
          attachments: input.attachments,
          capabilityId: input.capabilityId,
          safetyLevel: input.session.safetyLevel,
          suggestedTopicFilter: input.suggestedTopicFilter,
          eventBus: this.deps.eventBus,
          toolRunner: this.deps.toolRunner,
          toolDefinitions: this.deps.toolRegistry.listDefinitions(),
          modelClient: this.deps.modelClient,
          onDelta: (delta) => {
            streamedContent += delta;
            this.emitEvent("assistant.delta", input.session.id, input.runId, {
              messageId: assistantMessageId,
              delta,
            });
          },
        });
      } else {
        executeResult = await this.modeHandlers.execute.respond({
          session: input.session,
          message: input.message,
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
      }
    } catch (error) {
      modelFailed = true;
      assistantContent = streamedContent || toModelErrorMessage(error);
      this.emitServiceError(input.session.id, input.runId, error);
      return this.finishParserAuthoringRun(input, assistantMessageId, assistantContent, modelFailed);
    }

    if (executeResult.approvalInterrupt) {
      const request = this.parserAuthoringHandler.createApprovalRequest(
        input.runId,
        input.suggestedTopicFilter,
        input.message,
        input.session.safetyLevel,
        executeResult.approvalInterrupt.toolArgs,
        executeResult.approvalInterrupt.description,
      );
      this.pendingApprovals.set(request.id, {
        session: input.session,
        runId: input.runId,
        request,
        threadId: executeResult.approvalInterrupt.threadId,
        message: input.message,
        attachments: input.attachments,
        suggestedTopicFilter: input.suggestedTopicFilter,
        userMessageId: input.userMessageId,
        capabilityId: input.capabilityId,
        startedAt: input.startedAt,
      });
      this.deps.logger.info("approval requested", {
        sessionId: input.session.id,
        runId: input.runId,
        capabilityId: input.capabilityId,
        requestId: request.id,
        toolName: executeResult.approvalInterrupt.toolName,
      });
      this.emitEvent("run.status", input.session.id, input.runId, {
        runId: input.runId,
        status: "awaiting_approval",
        message: "Waiting for approval to create parser draft artifact",
      });
      this.emitEvent("approval.requested", input.session.id, input.runId, { request });
      const assistantContent = "Awaiting approval to create the parser draft artifact.";
      this.emitEvent("assistant.final", input.session.id, input.runId, {
        messageId: assistantMessageId,
        content: assistantContent,
        finishReason: "stop",
      });
      return {
        session: input.session,
        userMessageId: input.userMessageId,
        assistantMessageId,
        assistantContent,
      };
    }

    const normalizedArtifact = this.parserAuthoringHandler.normalizeArtifactCandidate({
      runId: input.runId,
      request: input.message,
      topicFilter: input.suggestedTopicFilter,
      attachmentCount: input.attachments.length,
      artifactCandidate: executeResult.artifactCandidate,
    });
    if (!normalizedArtifact.artifact) {
      modelFailed = true;
      assistantContent =
        normalizedArtifact.error ??
        "Parser authoring runtime did not return a valid parser artifact candidate.";
      this.emitServiceError(input.session.id, input.runId, new Error(assistantContent));
      return this.finishParserAuthoringRun(input, assistantMessageId, assistantContent, modelFailed);
    }

    const artifact = this.deps.artifactStore.save(normalizedArtifact.artifact);
    this.emitEvent("artifact.ready", input.session.id, input.runId, { artifact });
    assistantContent = this.normalizeAssistantText(executeResult.assistantText, artifact.summary);

    return this.finishParserAuthoringRun(input, assistantMessageId, assistantContent, modelFailed);
  }

  private finishParserAuthoringRun(
    input: {
      session: AgentSessionDto;
      runId: string;
      userMessageId: string;
      message: string;
      attachments: AgentAttachmentDto[];
      suggestedTopicFilter: string;
      capabilityId: string;
      startedAt: string;
    },
    assistantMessageId: string,
    assistantContent: string,
    modelFailed: boolean,
  ): Omit<AppendSessionMessageResult, "events"> {
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
    const completedAt = new Date().toISOString();
    this.emitEvent("run.completed", input.session.id, input.runId, {
      run: this.parserAuthoringHandler.createRun({
        session: input.session,
        runId: input.runId,
        goal: input.message,
        capabilityId: input.capabilityId,
        status: modelFailed ? "failed" : "completed",
        startedAt: input.startedAt,
        completedAt,
      }),
      finishReason: modelFailed ? "error" : "stop",
    });

    return {
      session: input.session,
      userMessageId: input.userMessageId,
      assistantMessageId,
      assistantContent,
    };
  }

  private normalizeAssistantText(assistantText: string, fallbackSummary?: string) {
    const trimmed = assistantText.trim();
    return trimmed || fallbackSummary || "Parser draft created and ready for review.";
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

export class AgentHarnessHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AgentHarnessHttpError";
  }
}

function toModelErrorMessage(error: unknown) {
  if (error instanceof ModelClientError) {
    return error.message;
  }

  return error instanceof Error ? error.message : "Agent request failed";
}
