import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModeHandlerDeps, ModeInput } from "../types.js";
import { ChatModeHandler } from "./index.js";

describe("ChatModeHandler", () => {
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
      id: "session-1",
      mode: "chat",
      safetyLevel: "observe",
      createdAt: "2026-04-15T00:00:00.000Z",
    },
    message: "diagnose this topic",
    attachments: [
      {
        id: "attachment-1",
        kind: "image",
        source: "file",
        mimeType: "image/png",
        filename: "capture.png",
        dataUrl: "data:image/png;base64,AAAA",
      },
    ],
    capabilityId: "topic-diagnosis",
    eventBus: eventBus as never,
    toolRunner: toolRunner as never,
    onDelta: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getSystemPrompt.mockReturnValue("chat system prompt");
    generate.mockResolvedValue({ content: "stream complete" });
  });

  it("injects the chat system prompt and returns model content", async () => {
    const handler = new ChatModeHandler(deps);

    await expect(handler.respond(input)).resolves.toBe("stream complete");

    expect(getSystemPrompt).toHaveBeenCalledWith("chat", "topic-diagnosis");
    expect(generate).toHaveBeenCalledWith({
      mode: "chat",
      systemPrompt: "chat system prompt",
      userMessage: input.message,
      attachments: input.attachments,
      onDelta: input.onDelta,
    });
  });

  it("forwards streaming deltas through the provided callback", async () => {
    generate.mockImplementationOnce(async (request) => {
      request.onDelta?.("part-1");
      request.onDelta?.("part-2");
      return { content: "final" };
    });
    const onDelta = vi.fn();
    const handler = new ChatModeHandler(deps);

    await handler.respond({ ...input, onDelta });

    expect(onDelta).toHaveBeenNthCalledWith(1, "part-1");
    expect(onDelta).toHaveBeenNthCalledWith(2, "part-2");
  });

  it("falls back to an undefined capability id when none is provided", async () => {
    const handler = new ChatModeHandler(deps);

    await handler.respond({ ...input, capabilityId: undefined, attachments: [] });

    expect(getSystemPrompt).toHaveBeenCalledWith("chat", undefined);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [],
      }),
    );
  });

  it("propagates model errors", async () => {
    const handler = new ChatModeHandler(deps);
    const error = new Error("model unavailable");
    generate.mockRejectedValueOnce(error);

    await expect(handler.respond(input)).rejects.toThrow(error);
  });
});
