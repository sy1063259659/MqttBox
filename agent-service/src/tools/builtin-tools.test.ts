import { describe, expect, it, vi } from "vitest";
import type { AgentArtifactDto, WorkspaceMemoryDto } from "@agent-contracts";
import { CapabilityRegistry } from "../capabilities/index.js";
import { TypedEventBus } from "../harness/event-bus.js";
import { registerBuiltinTools } from "./builtin-tools.js";
import { ToolRegistry } from "./registry.js";
import { ToolRunner } from "./runner.js";

function createMemory(overrides: Partial<WorkspaceMemoryDto> = {}): WorkspaceMemoryDto {
  return {
    id: "memory-1",
    kind: "note",
    scopeType: "topicPattern",
    scopeRef: "devices/+/status",
    title: "Status frame",
    content: "Byte 0 is flags, byte 1-2 is status word.",
    summary: "Status payload layout",
    language: "en-US",
    createdAt: "2026-04-17T10:00:00.000Z",
    updatedAt: "2026-04-17T10:00:00.000Z",
    source: "manual",
    pinned: false,
    ...overrides,
  };
}

function createArtifact(overrides: Partial<AgentArtifactDto> = {}): AgentArtifactDto {
  return {
    id: "artifact-1",
    runId: "run-1",
    capabilityId: "parser-authoring",
    type: "parser-script",
    schemaVersion: 1,
    title: "Factory Parser",
    summary: "Parser draft for factory/raw",
    payload: {
      editorPayload: {
        name: "Factory Parser",
        script: "function parse(input, helpers) { return { rawHex: input.payloadHex }; }",
      },
      reviewPayload: {
        summary: "Extract raw fields for factory/raw.",
        assumptions: ["Topic is stable"],
        risks: ["Field mapping may still change"],
        nextSteps: ["Validate against real payloads"],
      },
      suggestedTopicFilter: "factory/raw",
    },
    createdAt: "2026-04-17T10:05:00.000Z",
    ...overrides,
  };
}

function createDesktopBridgeClient() {
  return {
    listSavedParsers: vi.fn(async () => [
      {
        id: "parser-1",
        name: "Saved Parser",
        script: "function parse() { return {}; }",
        createdAt: 1,
        updatedAt: 2,
      },
    ]),
    loadTopicMessageSamples: vi.fn(async () => [
      {
        id: "sample-1",
        topic: "factory/raw",
        rawPayloadHex: "0102 03",
        parsedPayloadJson: "{\"temperature\":25}",
        parseError: null,
        receivedAt: 123,
      },
    ]),
    testParserScript: vi.fn(async () => ({
      ok: true,
      parsedPayloadJson: "{\"temperature\":25}",
      parseError: null,
    })),
    saveParserDraft: vi.fn(async () => ({
      id: "parser-2",
      name: "Draft Parser",
      script: "function parse() { return {}; }",
      createdAt: 3,
      updatedAt: 4,
    })),
  };
}

describe("registerBuiltinTools", () => {
  it("registers safe context tools and exposes helper metadata", async () => {
    const toolRegistry = new ToolRegistry();
    const desktopBridgeClient = createDesktopBridgeClient();
    registerBuiltinTools({
      toolRegistry,
      capabilityRegistry: new CapabilityRegistry(),
      memoryStore: {
        list: () => [createMemory()],
      } as never,
      artifactStore: {
        list: () => [createArtifact()],
      } as never,
      desktopBridgeClient: desktopBridgeClient as never,
    });

    const toolRunner = new ToolRunner(toolRegistry);
    const eventBus = new TypedEventBus();
    const events: string[] = [];
    eventBus.subscribeAll((event) => events.push(event.type));

    const helpersResult = await toolRunner.execute(
      "describe_parser_helpers",
      { names: ["readUint16BE", "readUint16LE"] },
      {
        sessionId: "session-1",
        runId: "run-1",
        eventBus,
      },
    );
    const artifactsResult = await toolRunner.execute(
      "list_recent_parser_artifacts",
      { limit: 1 },
      {
        sessionId: "session-1",
        runId: "run-1",
        eventBus,
      },
    );

    expect(toolRegistry.list().map((tool) => tool.id)).toEqual(
      expect.arrayContaining([
        "list_agent_capabilities",
        "list_registered_tools",
        "list_workspace_memories",
        "list_recent_parser_artifacts",
        "describe_parser_helpers",
        "list_saved_parsers",
        "load_topic_message_samples",
        "test_parser_script",
        "save_parser_draft",
      ]),
    );
    expect(helpersResult).toMatchObject({
      ok: true,
      output: {
        note: expect.stringContaining("explicit BE or LE"),
        helpers: [
          expect.objectContaining({ name: "readUint16BE" }),
          expect.objectContaining({ name: "readUint16LE" }),
        ],
      },
    });
    expect(artifactsResult).toMatchObject({
      ok: true,
      output: {
        artifacts: [
          expect.objectContaining({
            title: "Factory Parser",
            parserName: "Factory Parser",
            suggestedTopicFilter: "factory/raw",
          }),
        ],
      },
    });
    expect(events).toEqual(["tool.request", "tool.result", "tool.request", "tool.result"]);
    expect(toolRegistry.list().find((tool) => tool.id === "save_parser_draft")).toMatchObject({
      toolKind: "mutation",
      riskLevel: "medium",
      allowedModes: ["execute"],
      minSafetyLevel: "draft",
      requiresApproval: true,
      idempotent: false,
    });
  });

  it("lists memories with filtering and limit support", async () => {
    const toolRegistry = new ToolRegistry();
    const desktopBridgeClient = createDesktopBridgeClient();
    registerBuiltinTools({
      toolRegistry,
      capabilityRegistry: new CapabilityRegistry(),
      memoryStore: {
        list: () => [
          createMemory(),
          createMemory({
            id: "memory-2",
            scopeRef: "factory/raw",
            scopeType: "topicPattern",
            updatedAt: "2026-04-17T11:00:00.000Z",
          }),
        ],
      } as never,
      artifactStore: {
        list: vi.fn(() => []),
      } as never,
      desktopBridgeClient: desktopBridgeClient as never,
    });

    const result = await new ToolRunner(toolRegistry).execute(
      "list_workspace_memories",
      { scopeRef: "factory/raw", limit: 1 },
      {
        sessionId: "session-1",
        runId: null,
        eventBus: new TypedEventBus(),
      },
    );

    expect(result).toMatchObject({
      ok: true,
      output: {
        total: 1,
        items: [expect.objectContaining({ id: "memory-2", scopeRef: "factory/raw" })],
      },
    });
  });

  it("proxies parser library bridge tools for listing, testing, sampling, and saving", async () => {
    const toolRegistry = new ToolRegistry();
    const desktopBridgeClient = createDesktopBridgeClient();
    registerBuiltinTools({
      toolRegistry,
      capabilityRegistry: new CapabilityRegistry(),
      memoryStore: {
        list: () => [],
      } as never,
      artifactStore: {
        list: () => [],
      } as never,
      desktopBridgeClient: desktopBridgeClient as never,
    });

    const toolRunner = new ToolRunner(toolRegistry);
    const eventBus = new TypedEventBus();

    const parsersResult = await toolRunner.execute(
      "list_saved_parsers",
      { limit: 1 },
      { sessionId: "session-1", runId: "run-1", eventBus },
    );
    const samplesResult = await toolRunner.execute(
      "load_topic_message_samples",
      { topic: "factory/raw", limit: 1 },
      { sessionId: "session-1", runId: "run-1", eventBus },
    );
    const testResult = await toolRunner.execute(
      "test_parser_script",
      {
        script: "function parse() { return {}; }",
        payloadHex: "0102",
        topic: "factory/raw",
      },
      { sessionId: "session-1", runId: "run-1", eventBus },
    );
    const saveResult = await toolRunner.execute(
      "save_parser_draft",
      {
        name: "Draft Parser",
        script: "function parse() { return {}; }",
      },
      { sessionId: "session-1", runId: "run-1", eventBus },
    );

    expect(parsersResult).toMatchObject({
      ok: true,
      output: {
        total: 1,
        items: [expect.objectContaining({ id: "parser-1", name: "Saved Parser" })],
      },
    });
    expect(samplesResult).toMatchObject({
      ok: true,
      output: {
        total: 1,
        items: [expect.objectContaining({ id: "sample-1", topic: "factory/raw" })],
      },
    });
    expect(testResult).toMatchObject({
      ok: true,
      output: {
        ok: true,
        parsedPayloadJson: "{\"temperature\":25}",
      },
    });
    expect(saveResult).toMatchObject({
      ok: true,
      output: {
        id: "parser-2",
        name: "Draft Parser",
      },
    });
  });
});
