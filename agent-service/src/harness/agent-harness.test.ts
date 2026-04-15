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
  modelGenerate: ReturnType<typeof vi.fn>;
  deepAgentsInitialize: ReturnType<typeof vi.fn>;
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
  const modelGenerate = vi.fn(async () => ({ content: "default model response" }));
  const deepAgentsInitialize = vi.fn(async () => {});

  const modelClient: ModelClient = {
    provider: "mock",
    generate: modelGenerate,
    configure: vi.fn(),
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
    } as unknown as DeepAgentsAdapter,
    modelClient,
    toolRegistry: new ToolRegistry(),
    toolRunner: new ToolRunner(new ToolRegistry()),
  });

  activeHarness = harness;

  return {
    harness,
    scheduler,
    modelGenerate,
    deepAgentsInitialize,
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

    fixture.modelGenerate.mockImplementationOnce(async (request) => {
      request.onDelta?.("diag ");
      request.onDelta?.("ready");
      return { content: "topic diagnosis ready" };
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
    expect(fixture.modelGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "chat",
        userMessage: "Please diagnose this topic",
        attachments: [attachment],
        systemPrompt: expect.stringContaining("MQTT topic diagnosis assistant"),
      }),
    );
  });

  it("runs execute-mode happy path, emits plan/artifact events, and stores the generated artifact", async () => {
    const fixture = createHarnessFixture();
    await fixture.harness.start();
    const { session } = fixture.harness.createSession({ mode: "execute", safetyLevel: "draft" });

    fixture.modelGenerate.mockImplementationOnce(async (request) => {
      request.onDelta?.("parser ");
      request.onDelta?.("summary");
      return { content: "parser summary" };
    });

    const result = await fixture.harness.appendSessionMessage({
      sessionId: session.id,
      message: "Create parser for topic: devices/temperature using payload bytes",
    });

    expect(result.assistantContent).toBe("parser summary");
    expect(eventTypes(result.events)).toEqual([
      "session.message",
      "plan.ready",
      "plan.step.started",
      "plan.step.completed",
      "plan.step.started",
      "plan.step.completed",
      "plan.step.started",
      "plan.step.completed",
      "artifact.ready",
      "assistant.delta",
      "assistant.delta",
      "assistant.final",
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
        suggestedTopicFilter: "devices/temperature",
      }),
    });
    expect(fixture.artifactStore.getByRunId(runId)).toEqual([artifactReady.payload.artifact]);
    expect(fixture.modelGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "execute",
        systemPrompt: expect.stringContaining("MQTT parser authoring assistant"),
        userMessage: expect.stringContaining("Suggested topic filter: devices/temperature"),
      }),
    );
  });

  it("requests approval in confirm mode and completes the run after approval is granted", async () => {
    const fixture = createHarnessFixture();
    await fixture.harness.start();
    const { session } = fixture.harness.createSession({ mode: "execute", safetyLevel: "confirm" });

    const appendResult = await fixture.harness.appendSessionMessage({
      sessionId: session.id,
      message: "Create parser for topic: factory/raw",
    });

    expect(fixture.modelGenerate).not.toHaveBeenCalled();
    expect(eventTypes(appendResult.events)).toEqual([
      "session.message",
      "plan.ready",
      "plan.step.started",
      "plan.step.completed",
      "plan.step.started",
      "plan.step.completed",
      "plan.step.started",
      "plan.step.completed",
      "approval.requested",
      "assistant.final",
    ]);

    const approvalRequested = requireEvent(appendResult.events, "approval.requested");
    const runId = approvalRequested.payload.request.runId;
    expect(appendResult.assistantContent).toBe("Awaiting approval to create the parser draft artifact.");
    expect(fixture.artifactStore.getByRunId(runId)).toEqual([]);

    fixture.modelGenerate.mockImplementationOnce(async (request) => {
      request.onDelta?.("approved summary");
      return { content: "parser approved" };
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
      "artifact.ready",
      "assistant.delta",
      "assistant.final",
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

    expect(eventTypes(resolveResult.events)).toEqual(["approval.resolved", "assistant.final"]);
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
    expect(fixture.artifactStore.getByRunId(resolveResult.runId)).toEqual([]);
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

    expect(eventTypes(resolveResult.events)).toEqual(["approval.resolved", "assistant.final"]);
    expect(fixture.modelGenerate).not.toHaveBeenCalled();
    expect(fixture.artifactStore.getByRunId(resolveResult.runId)).toEqual([]);
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
