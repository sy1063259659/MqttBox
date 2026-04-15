import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModeHandlerDeps, ModeInput } from "../types.js";
import { ExecuteModeHandler } from "./index.js";

describe("ExecuteModeHandler", () => {
  const generate = vi.fn();
  const getSystemPrompt = vi.fn();
  const eventBus = { publish: vi.fn(), subscribe: vi.fn(), subscribeAll: vi.fn() };
  const toolRunner = { execute: vi.fn() };
  const deps = {
    modelClient: {
      provider: "mock",
      generate,
      configure: vi.fn(),
      getConfigSummary: vi.fn(),
    },
    promptRegistry: {
      getSystemPrompt,
    },
    eventBus,
    toolRunner,
  } as unknown as ModeHandlerDeps;

  const input: ModeInput = {
    session: {
      id: "session-2",
      mode: "execute",
      safetyLevel: "draft",
      createdAt: "2026-04-15T00:00:00.000Z",
    },
    message: "generate parser steps",
    attachments: [],
    capabilityId: "parser-authoring",
    eventBus: eventBus as never,
    toolRunner: toolRunner as never,
    onDelta: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getSystemPrompt.mockReturnValue("execute system prompt");
    generate.mockResolvedValue({ content: "plan complete" });
  });

  it("injects the execute system prompt and returns model content", async () => {
    const handler = new ExecuteModeHandler(deps);

    await expect(handler.respond(input)).resolves.toBe("plan complete");

    expect(getSystemPrompt).toHaveBeenCalledWith("execute", "parser-authoring");
    expect(generate).toHaveBeenCalledWith({
      mode: "execute",
      systemPrompt: "execute system prompt",
      userMessage: input.message,
      attachments: input.attachments,
      onDelta: input.onDelta,
    });
  });

  it("forwards streaming deltas during execution responses", async () => {
    generate.mockImplementationOnce(async (request) => {
      request.onDelta?.("step-1");
      request.onDelta?.("step-2");
      return { content: "artifact ready" };
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

  it("propagates model errors for execute mode", async () => {
    const handler = new ExecuteModeHandler(deps);
    generate.mockRejectedValueOnce(new Error("execution failed"));

    await expect(handler.respond(input)).rejects.toThrow("execution failed");
  });
});
