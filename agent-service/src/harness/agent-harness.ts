import { randomUUID } from "node:crypto";
import type {
  AgentArtifactDto,
  AgentAttachmentDto,
  AgentEvent,
  AgentEventEnvelope,
  AgentEventPayloadByType,
  AgentEventType,
  AgentServiceConfigDto,
  AgentSafetyLevel,
  AgentSessionDetailDto,
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
import { packSessionContext } from "../persistence/session-context.js";
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
  mode?: AgentSessionMode;
  safetyLevel?: AgentSafetyLevel;
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

export interface SessionListResult {
  sessions: AgentSessionDto[];
}

export interface SessionDetailResult {
  detail: AgentSessionDetailDto;
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
    | {
        kind: "artifact_capture";
        session: AgentSessionDto;
        runId: string;
        request: ApprovalRequestDto;
        threadId: string;
        message: string;
        mode: AgentSessionMode;
        safetyLevel: AgentSafetyLevel;
        attachments: AgentAttachmentDto[];
        suggestedTopicFilter: string;
        userMessageId: string;
        capabilityId: string;
        startedAt: string;
      }
    | {
        kind: "save_parser_draft";
        session: AgentSessionDto;
        runId: string;
        request: ApprovalRequestDto;
        userMessageId: string;
        capabilityId: string;
        startedAt: string;
        message: string;
        mode: AgentSessionMode;
        safetyLevel: AgentSafetyLevel;
        artifact: AgentArtifactDto;
        saveInput: {
          id?: string;
          name: string;
          script: string;
        };
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

      const detail = this.deps.sessionStore.create(mode, safetyLevel);
      const session = detail.session;
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

  listSessions(): SessionListResult {
    return {
      sessions: this.deps.sessionStore.list(),
    };
  }

  getSessionDetail(sessionId: string): SessionDetailResult | null {
    const detail = this.deps.sessionStore.getDetail(sessionId);
    return detail ? { detail } : null;
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

      const mode = input.mode ?? session.draftMode;
      const safetyLevel = input.safetyLevel ?? session.draftSafetyLevel;
      this.deps.sessionStore.updateDraftPreferences(session.id, mode, safetyLevel);

      const userMessageId = randomUUID();
      const capabilityMatch = await this.deps.capabilityRegistry.resolveWithFallback(mode, input.message);
      const capability = capabilityMatch.capability;
      const sessionDetail = this.deps.sessionStore.getDetail(session.id);
      const packedContext = sessionDetail
        ? packSessionContext(sessionDetail, input.message)
        : { packedText: input.message, usedSummary: false };
      this.deps.logger.info("message accepted", {
        sessionId: session.id,
        mode,
        safetyLevel,
        capabilityId: capability.id,
        capabilityConfidence: capabilityMatch.confidence,
        capabilityReason: capabilityMatch.matchReason,
        contextCompressed: packedContext.usedSummary,
      });
      this.emitEvent("session.message", session.id, null, {
        messageId: userMessageId,
        role: "user",
        content: input.message,
        mode,
        safetyLevel,
        attachments: input.attachments ?? [],
      });

      const assistantMessageId = randomUUID();
      let streamedContent = "";
      try {
        if (mode === "execute") {
          return this.handleExecuteMode(
            session,
            mode,
            safetyLevel,
            input.message,
            packedContext.packedText,
            input.attachments ?? [],
            userMessageId,
            capability.id,
          );
        }

        const response = await this.modeHandlers.chat.respond({
          session,
          message: input.message,
          modelMessage: packedContext.packedText,
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
    mode: AgentSessionMode,
    safetyLevel: AgentSafetyLevel,
    message: string,
    modelMessage: string,
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
        mode,
        safetyLevel,
        status: "planning",
        startedAt,
      }),
    });
    this.deps.logger.info("run started", {
      sessionId: session.id,
      runId,
      mode,
      safetyLevel,
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
        mode,
        safetyLevel,
        runId,
        userMessageId,
        message,
        modelMessage,
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

      if (pending.kind === "artifact_capture") {
        if (outcome === "approved") {
          await this.completeParserAuthoring({
            session: pending.session,
            mode: pending.mode,
            safetyLevel: pending.safetyLevel,
            runId: pending.runId,
            userMessageId: pending.userMessageId,
            message: pending.message,
            modelMessage: pending.message,
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
              mode: pending.mode,
              safetyLevel: pending.safetyLevel,
              status: "failed",
              startedAt: pending.startedAt,
              completedAt,
            }),
            finishReason: "error",
          });
        }
      } else if (outcome === "approved") {
        const saveResult = await this.deps.toolRunner.execute(
          "save_parser_draft",
          pending.saveInput,
          {
            sessionId,
            runId: pending.runId,
            eventBus: this.deps.eventBus,
          },
        );

        if (!saveResult.ok) {
          const errorMessage =
            saveResult.error ?? "Failed to save parser draft to the local library.";
          this.emitServiceError(sessionId, pending.runId, new Error(errorMessage));
          this.emitEvent("assistant.final", sessionId, pending.runId, {
            messageId: randomUUID(),
            content: errorMessage,
            finishReason: "error",
          });
          this.emitEvent("run.completed", sessionId, pending.runId, {
            run: this.parserAuthoringHandler.createRun({
              session: pending.session,
              runId: pending.runId,
              goal: pending.message,
              capabilityId: pending.capabilityId,
              mode: pending.mode,
              safetyLevel: pending.safetyLevel,
              status: "failed",
              startedAt: pending.startedAt,
              completedAt: new Date().toISOString(),
            }),
            finishReason: "error",
          });
        } else {
          this.emitEvent("assistant.final", sessionId, pending.runId, {
            messageId: randomUUID(),
            content: `Saved parser draft "${pending.saveInput.name}" to the local Parser Library.`,
            finishReason: "stop",
          });
          this.emitEvent("run.completed", sessionId, pending.runId, {
            run: this.parserAuthoringHandler.createRun({
              session: pending.session,
              runId: pending.runId,
              goal: pending.message,
              capabilityId: pending.capabilityId,
              mode: pending.mode,
              safetyLevel: pending.safetyLevel,
              status: "completed",
              startedAt: pending.startedAt,
              completedAt: new Date().toISOString(),
            }),
            finishReason: "stop",
          });
        }
      } else {
        const content =
          outcome === "rejected"
            ? "Parser draft was generated but not saved to the local Parser Library."
            : "Parser draft save approval expired before the draft was saved.";
        this.emitEvent("assistant.final", sessionId, pending.runId, {
          messageId: randomUUID(),
          content,
          finishReason: "stop",
        });
        this.emitEvent("run.completed", sessionId, pending.runId, {
          run: this.parserAuthoringHandler.createRun({
            session: pending.session,
            runId: pending.runId,
            goal: pending.message,
            capabilityId: pending.capabilityId,
            mode: pending.mode,
            safetyLevel: pending.safetyLevel,
            status: "completed",
            startedAt: pending.startedAt,
            completedAt: new Date().toISOString(),
          }),
          finishReason: "stop",
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
    mode: AgentSessionMode;
    safetyLevel: AgentSafetyLevel;
    runId: string;
    userMessageId: string;
    message: string;
    modelMessage: string;
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
          userMessage: input.modelMessage,
          attachments: input.attachments,
          capabilityId: input.capabilityId,
          safetyLevel: input.safetyLevel,
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
          modelMessage: input.modelMessage,
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
        input.safetyLevel,
        executeResult.approvalInterrupt.toolArgs,
        executeResult.approvalInterrupt.description,
      );
      this.pendingApprovals.set(request.id, {
        kind: "artifact_capture",
        session: input.session,
        runId: input.runId,
        request,
        threadId: executeResult.approvalInterrupt.threadId,
        message: input.message,
        mode: input.mode,
        safetyLevel: input.safetyLevel,
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

    const artifact = this.deps.artifactStore.save(
      await this.runParserDraftSmokeTest(input, normalizedArtifact.artifact),
    );
    this.emitEvent("artifact.ready", input.session.id, input.runId, { artifact });
    assistantContent = this.normalizeAssistantText(executeResult.assistantText, artifact.summary);

    if (this.parserAuthoringHandler.shouldRequestSave(input.message)) {
      const saveInput = this.createParserSaveInput(artifact);
      const existingParserId =
        /\b(overwrite|replace|update)\b|覆盖|替换|更新/.test(input.message.toLowerCase())
          ? await this.findExistingParserIdByName(saveInput.name, input)
          : null;
      const request = this.parserAuthoringHandler.createSaveApprovalRequest({
        runId: input.runId,
        request: input.message,
        safetyLevel: input.safetyLevel,
        artifact,
        existingParserId,
      });
      const nextSaveInput = existingParserId ? { ...saveInput, id: existingParserId } : saveInput;
      this.pendingApprovals.set(request.id, {
        kind: "save_parser_draft",
        session: input.session,
        runId: input.runId,
        request,
        userMessageId: input.userMessageId,
        capabilityId: input.capabilityId,
        startedAt: input.startedAt,
        message: input.message,
        mode: input.mode,
        safetyLevel: input.safetyLevel,
        artifact,
        saveInput: nextSaveInput,
      });
      this.emitEvent("run.status", input.session.id, input.runId, {
        runId: input.runId,
        status: "awaiting_approval",
        message: "Waiting for approval to save the parser draft to the local library",
      });
      this.emitEvent("approval.requested", input.session.id, input.runId, { request });
      this.emitEvent("assistant.final", input.session.id, input.runId, {
        messageId: assistantMessageId,
        content: "Parser draft is ready and awaiting approval before it is saved to the local Parser Library.",
        finishReason: "stop",
      });
      return {
        session: input.session,
        userMessageId: input.userMessageId,
        assistantMessageId,
        assistantContent:
          "Parser draft is ready and awaiting approval before it is saved to the local Parser Library.",
      };
    }

    return this.finishParserAuthoringRun(input, assistantMessageId, assistantContent, modelFailed);
  }

  private finishParserAuthoringRun(
    input: {
      session: AgentSessionDto;
      mode: AgentSessionMode;
      safetyLevel: AgentSafetyLevel;
      runId: string;
      userMessageId: string;
      message: string;
      modelMessage: string;
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
      safetyLevel: input.safetyLevel,
      finishReason: modelFailed ? "error" : "stop",
    });
    const completedAt = new Date().toISOString();
    this.emitEvent("run.completed", input.session.id, input.runId, {
      run: this.parserAuthoringHandler.createRun({
        session: input.session,
        runId: input.runId,
        goal: input.message,
        capabilityId: input.capabilityId,
        mode: input.mode,
        safetyLevel: input.safetyLevel,
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

  private async runParserDraftSmokeTest(
    input: {
      session: AgentSessionDto;
      runId: string;
      message: string;
      suggestedTopicFilter: string;
    },
    artifact: AgentArtifactDto,
  ): Promise<AgentArtifactDto> {
    if (!this.deps.toolRegistry.get("test_parser_script")) {
      return artifact;
    }

    const saveInput = this.createParserSaveInput(artifact);
    const payloadHex =
      this.readArtifactEditorString(artifact, "suggestedTestPayloadHex") ??
      (await this.findSamplePayloadHex(input));

    if (!payloadHex) {
      return artifact;
    }

    const result = await this.deps.toolRunner.execute(
      "test_parser_script",
      {
        script: saveInput.script,
        payloadHex,
        topic: input.suggestedTopicFilter,
      },
      {
        sessionId: input.session.id,
        runId: input.runId,
        eventBus: this.deps.eventBus,
      },
    );

    if (!result.ok || !result.output || typeof result.output !== "object") {
      return artifact;
    }

    const output = result.output as {
      ok?: boolean;
      parsedPayloadJson?: string | null;
      parseError?: string | null;
    };
    const payload = (artifact.payload ?? {}) as Record<string, unknown>;
    const reviewPayload =
      typeof payload.reviewPayload === "object" && payload.reviewPayload !== null
        ? ({ ...(payload.reviewPayload as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const risks = Array.isArray(reviewPayload.risks)
      ? (reviewPayload.risks as string[]).filter((item) => typeof item === "string" && item.trim().length > 0)
      : [];

    if (output.ok) {
      reviewPayload.summary =
        typeof reviewPayload.summary === "string" && reviewPayload.summary.trim().length > 0
          ? `${reviewPayload.summary} Smoke test passed against ${payloadHex}.`
          : `Smoke test passed against ${payloadHex}.`;
      reviewPayload.testResult = {
        ok: true,
        payloadHex,
        parsedPayloadJson: output.parsedPayloadJson ?? null,
        parseError: null,
      };
    } else {
      const parseError = output.parseError ?? "Parser smoke test failed.";
      reviewPayload.summary =
        typeof reviewPayload.summary === "string" && reviewPayload.summary.trim().length > 0
          ? `${reviewPayload.summary} Smoke test currently fails: ${parseError}`
          : `Smoke test currently fails: ${parseError}`;
      reviewPayload.testResult = {
        ok: false,
        payloadHex,
        parsedPayloadJson: output.parsedPayloadJson ?? null,
        parseError,
      };
      if (!risks.some((risk) => risk === parseError)) {
        risks.unshift(parseError);
      }
      reviewPayload.risks = risks.slice(0, 3);
    }

    return {
      ...artifact,
      payload: {
        ...payload,
        reviewPayload,
      },
    };
  }

  private async findSamplePayloadHex(input: {
    session: AgentSessionDto;
    runId: string;
    suggestedTopicFilter: string;
  }): Promise<string | null> {
    if (!this.deps.toolRegistry.get("load_topic_message_samples")) {
      return null;
    }

    const result = await this.deps.toolRunner.execute(
      "load_topic_message_samples",
      {
        topic: input.suggestedTopicFilter,
        limit: 1,
      },
      {
        sessionId: input.session.id,
        runId: input.runId,
        eventBus: this.deps.eventBus,
      },
    );

    if (!result.ok || !result.output || typeof result.output !== "object") {
      return null;
    }

    const items = Array.isArray((result.output as Record<string, unknown>).items)
      ? ((result.output as Record<string, unknown>).items as Array<Record<string, unknown>>)
      : [];
    const sample = items.find(
      (item) => typeof item.rawPayloadHex === "string" && item.rawPayloadHex.trim().length > 0,
    );
    return typeof sample?.rawPayloadHex === "string" ? sample.rawPayloadHex : null;
  }

  private async findExistingParserIdByName(
    parserName: string,
    input: {
      session: AgentSessionDto;
      runId: string;
    },
  ): Promise<string | null> {
    if (!this.deps.toolRegistry.get("list_saved_parsers")) {
      return null;
    }

    const result = await this.deps.toolRunner.execute(
      "list_saved_parsers",
      {
        limit: 20,
      },
      {
        sessionId: input.session.id,
        runId: input.runId,
        eventBus: this.deps.eventBus,
      },
    );

    if (!result.ok || !result.output || typeof result.output !== "object") {
      return null;
    }

    const items = Array.isArray((result.output as Record<string, unknown>).items)
      ? ((result.output as Record<string, unknown>).items as Array<Record<string, unknown>>)
      : [];
    const match = items.find(
      (item) =>
        typeof item.name === "string" &&
        item.name.trim().toLowerCase() === parserName.trim().toLowerCase() &&
        typeof item.id === "string" &&
        item.id.trim().length > 0,
    );

    return typeof match?.id === "string" ? match.id : null;
  }

  private createParserSaveInput(artifact: AgentArtifactDto) {
    const name = this.readArtifactEditorString(artifact, "name") ?? artifact.title;
    const script = this.readArtifactEditorString(artifact, "script") ?? "";
    return {
      name,
      script,
    };
  }

  private readArtifactEditorString(
    artifact: AgentArtifactDto,
    key: string,
  ): string | null {
    if (!artifact.payload || typeof artifact.payload !== "object") {
      return null;
    }

    const payload = artifact.payload as Record<string, unknown>;
    if (!payload.editorPayload || typeof payload.editorPayload !== "object") {
      return null;
    }

    const value = (payload.editorPayload as Record<string, unknown>)[key];
    return typeof value === "string" && value.trim().length > 0 ? value : null;
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

    this.deps.sessionStore.applyEvent(event);
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
