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

describe("registerBuiltinTools", () => {
  it("registers safe context tools and exposes helper metadata", async () => {
    const toolRegistry = new ToolRegistry();
    registerBuiltinTools({
      toolRegistry,
      capabilityRegistry: new CapabilityRegistry(),
      memoryStore: {
        list: () => [createMemory()],
      } as never,
      artifactStore: {
        list: () => [createArtifact()],
      } as never,
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
  });

  it("lists memories with filtering and limit support", async () => {
    const toolRegistry = new ToolRegistry();
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
});
