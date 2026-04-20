import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModeHandlerDeps, ModeInput } from "../types.js";
import { ToolRegistry } from "../../tools/registry.js";
import { ExecuteModeHandler } from "./index.js";

describe("ExecuteModeHandler", () => {
  const runExecute = vi.fn();
  const getSystemPrompt = vi.fn();
  const eventBus = { publish: vi.fn(), subscribe: vi.fn(), subscribeAll: vi.fn() };
  const toolRunner = { execute: vi.fn() };
  const toolRegistry = new ToolRegistry();
  const deps = {
    modelClient: {
      provider: "mock",
      generate: vi.fn(),
      configure: vi.fn(),
      getRuntimeConfig: vi.fn(),
      getConfigSummary: vi.fn(),
    },
    promptRegistry: {
      getSystemPrompt,
    },
    eventBus,
    toolRegistry,
    toolRunner,
    deepAgentsAdapter: {
      runtime: "deepagentsjs-test",
      initialize: vi.fn(),
      runChat: vi.fn(),
      runExecute,
    },
  } as unknown as ModeHandlerDeps;

  const input: ModeInput = {
    session: {
      id: "session-2",
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
      title: "Parser run",
      lastMessagePreview: null,
      draftMode: "execute",
      draftSafetyLevel: "draft",
    },
    message: "generate parser steps",
    attachments: [],
    capabilityId: "parser-authoring",
    runId: "run-2",
    eventBus: eventBus as never,
    toolRunner: toolRunner as never,
    onDelta: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getSystemPrompt.mockReturnValue("execute system prompt");
    runExecute.mockResolvedValue({
      assistantText: "plan complete",
      artifactCandidate: { name: "Parser", script: "function parse() { return {}; }" },
    });
  });

  it("injects the execute system prompt and returns runtime content", async () => {
    const handler = new ExecuteModeHandler(deps);

    await expect(handler.respond(input)).resolves.toEqual({
      assistantText: "plan complete",
      artifactCandidate: { name: "Parser", script: "function parse() { return {}; }" },
    });

    expect(getSystemPrompt).toHaveBeenCalledWith("execute", "parser-authoring");
    expect(runExecute).toHaveBeenCalledWith({
      sessionId: input.session.id,
      systemPrompt: "execute system prompt",
      userMessage: input.message,
      attachments: input.attachments,
      onDelta: input.onDelta,
      capabilityId: input.capabilityId,
      runId: input.runId,
      safetyLevel: input.session.draftSafetyLevel,
      eventBus,
      toolRunner,
      toolDefinitions: [],
      modelClient: deps.modelClient,
    });
  });

  it("forwards streaming deltas during execution responses", async () => {
    runExecute.mockImplementationOnce(async (request) => {
      request.onDelta?.("step-1");
      request.onDelta?.("step-2");
      return { assistantText: "artifact ready" };
    });
    const onDelta = vi.fn();
    const handler = new ExecuteModeHandler(deps);

    await handler.respond({ ...input, onDelta });

    expect(onDelta).toHaveBeenNthCalledWith(1, "step-1");
    expect(onDelta).toHaveBeenNthCalledWith(2, "step-2");
  });

  it("uses the generic execute prompt when capability id is absent", async () => {
    const handler = new ExecuteModeHandler(deps);

    await handler.respond({ ...input, capabilityId: null });

    expect(getSystemPrompt).toHaveBeenCalledWith("execute", null);
  });

  it("propagates runtime errors for execute mode", async () => {
    const handler = new ExecuteModeHandler(deps);
    runExecute.mockRejectedValueOnce(new Error("execution failed"));

    await expect(handler.respond(input)).rejects.toThrow("execution failed");
  });
});
