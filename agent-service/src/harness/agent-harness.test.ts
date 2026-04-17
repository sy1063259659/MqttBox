import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentArtifactDto, AgentAttachmentDto, AgentEvent, AgentSessionDto } from "@agent-contracts";
import { BudgetManager } from "../budget/index.js";
import { CapabilityRegistry } from "../capabilities/index.js";
import type { DeepAgentsAdapter } from "../integrations/deepagents-adapter.js";
import type { MemoryStore } from "../memory/index.js";
import type { ModelClient } from "../models/types.js";
import type { Logger } from "../observability/logger.js";
import { PolicyEngine } from "../policy/index.js";
import { PromptRegistry } from "../prompts/index.js";
import { RunScheduler } from "../scheduler/index.js";
import type { InMemorySessionStore } from "../persistence/session-store.js";
import { InMemoryTransport } from "../transport/inmemory-transport.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolRunner } from "../tools/runner.js";
import { AgentHarness } from "./agent-harness.js";
import { TypedEventBus } from "./event-bus.js";

class TestSessionStore {
  private readonly sessions = new Map<string, AgentSessionDto>();

  create(mode: AgentSessionDto["mode"], safetyLevel: AgentSessionDto["safetyLevel"]): AgentSessionDto {
    const session: AgentSessionDto = {
      id: `session-${this.sessions.size + 1}`,
      mode,
      safetyLevel,
      createdAt: new Date().toISOString(),
      workspaceId: null,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getById(sessionId: string): AgentSessionDto | null {
    return this.sessions.get(sessionId) ?? null;
  }
}

class TestArtifactStore {
  private readonly items = new Map<string, AgentArtifactDto>();

  save(artifact: AgentArtifactDto): AgentArtifactDto {
    this.items.set(artifact.id, artifact);
    return artifact;
  }

  listByRun(runId: string): AgentArtifactDto[] {
    return [...this.items.values()].filter((artifact) => artifact.runId === runId);
  }

  getByRunId(runId: string): AgentArtifactDto[] {
    return this.listByRun(runId);
  }

  getById(artifactId: string): AgentArtifactDto | null {
    return this.items.get(artifactId) ?? null;
  }
}

interface HarnessFixture {
  harness: AgentHarness;
  scheduler: RunScheduler;
  toolRegistry: ToolRegistry;
  modelGenerate: ReturnType<typeof vi.fn>;
  deepAgentsInitialize: ReturnType<typeof vi.fn>;
  deepAgentsRunChat: ReturnType<typeof vi.fn>;
  deepAgentsRunExecute: ReturnType<typeof vi.fn>;
  deepAgentsResumeExecute: ReturnType<typeof vi.fn>;
  artifactStore: TestArtifactStore;
  transportEvents: AgentEvent[];
  wsEvents: AgentEvent[];
}

let activeHarness: AgentHarness | null = null;

afterEach(async () => {
  await activeHarness?.stop();
  activeHarness = null;
  vi.restoreAllMocks();
});

function eventTypes(events: AgentEvent[]) {
  return events.map((event) => event.type);
}

function requireEvent<TType extends AgentEvent["type"]>(
  events: AgentEvent[],
  type: TType,
): Extract<AgentEvent, { type: TType }> {
  const event = events.find((candidate) => candidate.type === type);
  expect(event, `expected ${type} event to be present`).toBeDefined();
  if (!event || event.type !== type) {
    throw new Error(`Missing event: ${type}`);
  }
  return event as Extract<AgentEvent, { type: TType }>;
}

function createAttachment(): AgentAttachmentDto {
  return {
    id: "attachment-1",
    kind: "image",
    source: "file",
    mimeType: "image/png",
    filename: "capture.png",
    dataUrl: "data:image/png;base64,AAAA",
  };
}

function createArtifactCandidate(overrides: Record<string, unknown> = {}) {
  return {
    name: "Devices Temperature Parser",
    script: [
      "function parse(input, helpers) {",
      "  const bytes = helpers.hexToBytes(input.payloadHex);",
      '  return { topicFilter: "devices/temperature", byteLength: bytes.length };',
      "}",
    ].join("\n"),
    suggestedTestPayloadHex: "01020304",
    summary: "Parser draft for devices/temperature",
    reviewPayload: {
      summary: "Generated from execute mode. Draft targets devices/temperature.",
      assumptions: ["Topic stays stable"],
      risks: ["Field names may still need review"],
      nextSteps: ["Open the draft in ParserLibrary."],
    },
    suggestedTopicFilter: "devices/temperature",
    sourceSampleSummary: "Create parser for topic: devices/temperature using payload bytes",
    ...overrides,
  };
}

function createHarnessFixture(): HarnessFixture {
  const eventBus = new TypedEventBus();
  const transport = new InMemoryTransport();
  const wsTransport = new InMemoryTransport();
  const transportEvents: AgentEvent[] = [];
  const wsEvents: AgentEvent[] = [];
  transport.subscribe((event) => transportEvents.push(event));
  wsTransport.subscribe((event) => wsEvents.push(event));

  const scheduler = new RunScheduler();
  const artifactStore = new TestArtifactStore();
  const toolRegistry = new ToolRegistry();
  const toolRunner = new ToolRunner(toolRegistry);
  const modelGenerate = vi.fn(async () => ({ content: "default model response" }));
  const deepAgentsInitialize = vi.fn(async () => {});
  const deepAgentsRunChat = vi.fn(async () => ({
    assistantText: "default chat response",
  }));
  const deepAgentsRunExecute = vi.fn(async () => ({
    assistantText: "default execute response",
    artifactCandidate: createArtifactCandidate(),
  }));
  const deepAgentsResumeExecute = vi.fn(async () => ({
    assistantText: "default resumed execute response",
    artifactCandidate: createArtifactCandidate(),
  }));

  const modelClient: ModelClient = {
    provider: "mock",
    generate: modelGenerate,
    configure: vi.fn(),
    getRuntimeConfig: vi.fn(() => ({
      provider: "mock",
      enabled: true,
      apiKey: "test-key",
      baseUrl: "http://localhost/mock",
      model: "test-model",
    })),
    getConfigSummary: vi.fn(() => ({
      provider: "mock",
      configured: true,
      model: "test-model",
      baseUrl: "http://localhost/mock",
      enabled: true,
    })),
  };

  const harness = new AgentHarness({
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger,
    eventBus,
    sessionStore: new TestSessionStore() as unknown as InMemorySessionStore,
    transport,
    wsTransport,
    promptRegistry: new PromptRegistry(),
    policyEngine: new PolicyEngine(),
    scheduler,
    budgetManager: new BudgetManager(),
    capabilityRegistry: new CapabilityRegistry(),
    memoryStore: {
      list: () => [],
    } as unknown as MemoryStore,
    artifactStore: artifactStore as never,
    deepAgentsAdapter: {
      runtime: "deepagentsjs-test",
      initialize: deepAgentsInitialize,
      runChat: deepAgentsRunChat,
      runExecute: deepAgentsRunExecute,
      resumeExecute: deepAgentsResumeExecute,
    } as unknown as DeepAgentsAdapter,
    modelClient,
    toolRegistry,
    toolRunner,
  });

  activeHarness = harness;

  return {
    harness,
    scheduler,
    toolRegistry,
    modelGenerate,
    deepAgentsInitialize,
    deepAgentsRunChat,
    deepAgentsRunExecute,
    deepAgentsResumeExecute,
    artifactStore,
    transportEvents,
    wsEvents,
  };
}

describe("AgentHarness", () => {
  it("creates sessions with default mode, emits session.start, and publishes the event to transports", async () => {
    const fixture = createHarnessFixture();
    await fixture.harness.start();

    const result = fixture.harness.createSession();

    expect(result.session).toMatchObject({
      id: "session-1",
      mode: "chat",
      safetyLevel: "observe",
      workspaceId: null,
    });
    expect(eventTypes(result.events)).toEqual(["session.start"]);
    expect(result.events[0]).toMatchObject({
      type: "session.start",
      sessionId: result.session.id,
      runId: null,
      payload: {
        session: result.session,
      },
    });
    expect(fixture.scheduler.listBySession(result.session.id)).toEqual([
      expect.objectContaining({
        sessionId: result.session.id,
        capabilityId: "session.start",
      }),
    ]);
    expect(fixture.transportEvents).toEqual(result.events);
    expect(fixture.wsEvents).toEqual(result.events);
    expect(fixture.deepAgentsInitialize).toHaveBeenCalledTimes(1);
  });

  it("handles chat message flow with streaming deltas, scoped event collection, and onEvent forwarding", async () => {
    const fixture = createHarnessFixture();
    await fixture.harness.start();
    const { session } = fixture.harness.createSession({ mode: "chat" });
    const callbackEvents: AgentEvent[] = [];
    const attachment = createAttachment();

    fixture.deepAgentsRunChat.mockImplementationOnce(async (request) => {
      request.onDelta?.("diag ");
      request.onDelta?.("ready");
      return { assistantText: "topic diagnosis ready" };
    });

    const result = await fixture.harness.appendSessionMessage({
      sessionId: session.id,
      message: "Please diagnose this topic",
      attachments: [attachment],
      onEvent: (event) => callbackEvents.push(event),
    });

    expect(result.assistantContent).toBe("topic diagnosis ready");
    expect(eventTypes(result.events)).toEqual([
      "session.message",
      "assistant.delta",
      "assistant.delta",
      "assistant.final",
    ]);
    expect(callbackEvents).toEqual(result.events);
    expect(eventTypes(fixture.transportEvents.slice(-result.events.length))).toEqual(
      eventTypes(result.events),
    );
    expect(eventTypes(fixture.wsEvents.slice(-result.events.length))).toEqual(
      eventTypes(result.events),
    );
    expect(result.events).not.toContainEqual(expect.objectContaining({ type: "session.start" }));
    expect(requireEvent(result.events, "session.message")).toMatchObject({
      sessionId: session.id,
      payload: {
        role: "user",
        content: "Please diagnose this topic",
        mode: "chat",
        safetyLevel: "observe",
        attachments: [attachment],
      },
    });
    expect(requireEvent(result.events, "assistant.final")).toMatchObject({
      sessionId: session.id,
      runId: null,
      payload: {
        content: "topic diagnosis ready",
        finishReason: "stop",
      },
    });
    expect(fixture.deepAgentsRunChat).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        runId: null,
        userMessage: "Please diagnose this topic",
        attachments: [attachment],
        systemPrompt: expect.stringContaining("MQTT topic diagnosis assistant"),
      }),
    );
  });

  it("captures tool events in the same scoped event stream when the runtime executes a registered tool", async () => {
    const fixture = createHarnessFixture();
    await fixture.harness.start();
    const { session } = fixture.harness.createSession({ mode: "chat" });
    fixture.toolRegistry.register({
      name: "echo_context",
      description: "Echo test tool",
      inputSchema: {
        type: "object",
        properties: {
          value: { type: "string" },
        },
        additionalProperties: false,
      },
      handler: async (input) => ({
        ok: true,
        output: input,
      }),
    });

    fixture.deepAgentsRunChat.mockImplementationOnce(async (request) => {
      await request.toolRunner.execute("echo_context", { value: "tooling" }, {
        sessionId: request.sessionId,
        runId: request.runId ?? null,
        eventBus: request.eventBus,
      });
      return { assistantText: "tool run complete" };
    });

    const result = await fixture.harness.appendSessionMessage({
      sessionId: session.id,
      message: "Use a tool before answering",
    });

    expect(eventTypes(result.events)).toEqual([
      "session.message",
      "tool.request",
      "tool.result",
      "assistant.final",
    ]);
    expect(requireEvent(result.events, "tool.request")).toMatchObject({
      sessionId: session.id,
      runId: null,
      payload: {
        tool: expect.objectContaining({
          id: "echo_context",
          name: "echo_context",
        }),
        input: { value: "tooling" },
      },
    });
    expect(requireEvent(result.events, "tool.result")).toMatchObject({
      sessionId: session.id,
      runId: null,
      payload: {
        toolId: "echo_context",
        ok: true,
        output: { value: "tooling" },
      },
    });
  });

  it("runs execute-mode happy path, emits plan/artifact events, and stores the generated artifact", async () => {
    const fixture = createHarnessFixture();
    await fixture.harness.start();
    const { session } = fixture.harness.createSession({ mode: "execute", safetyLevel: "draft" });

    fixture.deepAgentsRunExecute.mockImplementationOnce(async (request) => {
      request.onDelta?.("parser ");
      request.onDelta?.("summary");
      return {
        assistantText: "parser summary",
        artifactCandidate: createArtifactCandidate(),
      };
    });

    const result = await fixture.harness.appendSessionMessage({
      sessionId: session.id,
      message: "Create parser for topic: devices/temperature using payload bytes",
    });

    expect(result.assistantContent).toBe("parser summary");
    expect(eventTypes(result.events)).toEqual([
      "session.message",
      "run.started",
      "plan.ready",
      "run.status",
      "plan.step.started",
      "plan.step.completed",
      "plan.step.started",
      "plan.step.completed",
      "plan.step.started",
      "plan.step.completed",
      "run.status",
      "run.status",
      "assistant.delta",
      "assistant.delta",
      "artifact.ready",
      "assistant.final",
      "run.completed",
    ]);

    const planReady = requireEvent(result.events, "plan.ready");
    const artifactReady = requireEvent(result.events, "artifact.ready");
    const runId = planReady.payload.plan.runId;

    expect(planReady.payload.plan).toMatchObject({
      runId,
      capabilityId: "parser-authoring",
      goal: "Create parser for topic: devices/temperature using payload bytes",
    });
    expect(artifactReady.runId).toBe(runId);
    expect(artifactReady.payload.artifact).toMatchObject({
      runId,
      capabilityId: "parser-authoring",
      type: "parser-script",
      title: "Devices Temperature Parser",
      summary: "Parser draft for devices/temperature",
      payload: expect.objectContaining({
        editorPayload: expect.objectContaining({
          name: "Devices Temperature Parser",
          script: expect.stringContaining('topicFilter: "devices/temperature"'),
        }),
        reviewPayload: expect.objectContaining({
          summary: expect.stringContaining("Draft targets devices/temperature"),
        }),
        suggestedTopicFilter: "devices/temperature",
      }),
    });
    expect(fixture.artifactStore.getByRunId(runId)).toEqual([artifactReady.payload.artifact]);
    expect(fixture.deepAgentsRunExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        capabilityId: "parser-authoring",
        userMessage: "Create parser for topic: devices/temperature using payload bytes",
        systemPrompt: expect.stringContaining("MQTT parser authoring assistant"),
      }),
    );
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
  });

  it("requests approval in confirm mode and completes the run after approval is granted", async () => {
    const fixture = createHarnessFixture();
    await fixture.harness.start();
    const { session } = fixture.harness.createSession({ mode: "execute", safetyLevel: "confirm" });

    fixture.deepAgentsRunExecute.mockResolvedValueOnce({
      assistantText: "",
      approvalInterrupt: {
        threadId: "run-confirm-1",
        toolName: "capture_parser_artifact",
        toolArgs: createArtifactCandidate({
          name: "Factory Raw Parser",
          summary: "Parser draft for factory/raw",
          suggestedTopicFilter: "factory/raw",
        }),
        description: "Review the generated parser draft before it is committed.",
        allowedDecisions: ["approve", "reject"],
      },
    });

    const appendResult = await fixture.harness.appendSessionMessage({
      sessionId: session.id,
      message: "Create parser for topic: factory/raw",
    });

    expect(fixture.modelGenerate).not.toHaveBeenCalled();
    expect(eventTypes(appendResult.events)).toEqual([
      "session.message",
      "run.started",
      "plan.ready",
      "run.status",
      "plan.step.started",
      "plan.step.completed",
      "plan.step.started",
      "plan.step.completed",
      "plan.step.started",
      "plan.step.completed",
      "run.status",
      "run.status",
      "run.status",
      "approval.requested",
      "assistant.final",
    ]);

    const approvalRequested = requireEvent(appendResult.events, "approval.requested");
    const runId = approvalRequested.payload.request.runId;
    expect(appendResult.assistantContent).toBe("Awaiting approval to create the parser draft artifact.");
    expect(fixture.artifactStore.getByRunId(runId)).toEqual([]);
    expect(approvalRequested.payload.request.inputPreview).toContain("Factory Raw Parser");
    expect(fixture.deepAgentsRunExecute).toHaveBeenCalledTimes(1);

    fixture.deepAgentsResumeExecute.mockImplementationOnce(async (request) => {
      request.onDelta?.("approved summary");
      return {
        assistantText: "parser approved",
        artifactCandidate: createArtifactCandidate({
          name: "Factory Raw Parser",
          summary: "Parser draft for factory/raw",
          suggestedTopicFilter: "factory/raw",
          sourceSampleSummary: "Create parser for topic: factory/raw",
          reviewPayload: {
            summary: "Generated from execute mode. Draft targets factory/raw.",
            assumptions: ["Topic remains stable"],
            risks: ["Payload semantics still need verification"],
            nextSteps: ["Open the draft in ParserLibrary."],
          },
        }),
      };
    });

    const resolveResult = await fixture.harness.resolveApproval(
      session.id,
      approvalRequested.payload.request.id,
      "approved",
    );

    expect(resolveResult).toMatchObject({
      session,
      runId,
      requestId: approvalRequested.payload.request.id,
      outcome: "approved",
    });
    expect(eventTypes(resolveResult.events)).toEqual([
      "approval.resolved",
      "run.status",
      "run.status",
      "assistant.delta",
      "artifact.ready",
      "assistant.final",
      "run.completed",
    ]);
    expect(requireEvent(resolveResult.events, "approval.resolved")).toMatchObject({
      sessionId: session.id,
      runId,
      payload: {
        requestId: approvalRequested.payload.request.id,
        outcome: "approved",
        resolver: "frontend-shell",
      },
    });
    expect(fixture.artifactStore.getByRunId(runId)).toHaveLength(1);
    expect(fixture.deepAgentsRunExecute).toHaveBeenCalledTimes(1);
    expect(fixture.deepAgentsResumeExecute).toHaveBeenCalledTimes(1);
    expect(requireEvent(resolveResult.events, "assistant.final")).toMatchObject({
      payload: {
        content: "parser approved",
        finishReason: "stop",
      },
    });
  });

  it("emits rejection resolution without generating an artifact when approval is denied", async () => {
    const fixture = createHarnessFixture();
    await fixture.harness.start();
    const { session } = fixture.harness.createSession({ mode: "execute", safetyLevel: "confirm" });

    fixture.deepAgentsRunExecute.mockResolvedValueOnce({
      assistantText: "",
      approvalInterrupt: {
        threadId: "run-confirm-2",
        toolName: "capture_parser_artifact",
        toolArgs: createArtifactCandidate({
          name: "Telemetry Parser",
          suggestedTopicFilter: "telemetry/raw",
        }),
        description: "Review telemetry parser draft.",
        allowedDecisions: ["approve", "reject"],
      },
    });

    const appendResult = await fixture.harness.appendSessionMessage({
      sessionId: session.id,
      message: "Create parser for topic: telemetry/raw",
    });
    const approvalRequested = requireEvent(appendResult.events, "approval.requested");

    const resolveResult = await fixture.harness.resolveApproval(
      session.id,
      approvalRequested.payload.request.id,
      "rejected",
    );

    expect(eventTypes(resolveResult.events)).toEqual([
      "approval.resolved",
      "assistant.final",
      "run.completed",
    ]);
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
    expect(fixture.artifactStore.getByRunId(resolveResult.runId)).toEqual([]);
    expect(fixture.deepAgentsResumeExecute).not.toHaveBeenCalled();
    expect(requireEvent(resolveResult.events, "assistant.final")).toMatchObject({
      sessionId: session.id,
      runId: resolveResult.runId,
      payload: {
        content: "Parser draft creation was rejected.",
        finishReason: "error",
      },
    });
  });

  it("emits expiration resolution without generating an artifact when approval expires", async () => {
    const fixture = createHarnessFixture();
    await fixture.harness.start();
    const { session } = fixture.harness.createSession({ mode: "execute", safetyLevel: "confirm" });

    fixture.deepAgentsRunExecute.mockResolvedValueOnce({
      assistantText: "",
      approvalInterrupt: {
        threadId: "run-confirm-3",
        toolName: "capture_parser_artifact",
        toolArgs: createArtifactCandidate({
          name: "Telemetry Parser",
          suggestedTopicFilter: "telemetry/raw",
        }),
        description: "Review telemetry parser draft.",
        allowedDecisions: ["approve", "reject"],
      },
    });

    const appendResult = await fixture.harness.appendSessionMessage({
      sessionId: session.id,
      message: "Create parser for topic: telemetry/raw",
    });
    const approvalRequested = requireEvent(appendResult.events, "approval.requested");

    const resolveResult = await fixture.harness.resolveApproval(
      session.id,
      approvalRequested.payload.request.id,
      "expired",
    );

    expect(eventTypes(resolveResult.events)).toEqual([
      "approval.resolved",
      "assistant.final",
      "run.completed",
    ]);
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
    expect(fixture.artifactStore.getByRunId(resolveResult.runId)).toEqual([]);
    expect(fixture.deepAgentsResumeExecute).not.toHaveBeenCalled();
    expect(requireEvent(resolveResult.events, "assistant.final")).toMatchObject({
      sessionId: session.id,
      runId: resolveResult.runId,
      payload: {
        content: "Parser draft approval expired.",
        finishReason: "error",
      },
    });
  });
});
