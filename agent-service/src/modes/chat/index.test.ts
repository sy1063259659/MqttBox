import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModeHandlerDeps, ModeInput } from "../types.js";
import { ToolRegistry } from "../../tools/registry.js";
import { ChatModeHandler } from "./index.js";

describe("ChatModeHandler", () => {
  const runChat = vi.fn();
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
      runChat,
      runExecute: vi.fn(),
    },
  } as unknown as ModeHandlerDeps;

  const input: ModeInput = {
    session: {
      id: "session-1",
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
      title: "Topic diagnosis",
      lastMessagePreview: null,
      draftMode: "chat",
      draftSafetyLevel: "observe",
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
    runChat.mockResolvedValue({ assistantText: "stream complete" });
  });

  it("injects the chat system prompt and returns the runtime result", async () => {
    const handler = new ChatModeHandler(deps);

    await expect(handler.respond(input)).resolves.toEqual({ assistantText: "stream complete" });

    expect(getSystemPrompt).toHaveBeenCalledWith("chat", "topic-diagnosis");
    expect(runChat).toHaveBeenCalledWith({
      sessionId: input.session.id,
      runId: null,
      systemPrompt: "chat system prompt",
      userMessage: input.message,
      attachments: input.attachments,
      onDelta: input.onDelta,
      eventBus,
      toolRunner,
      toolDefinitions: [],
      modelClient: deps.modelClient,
    });
  });

  it("forwards streaming deltas through the provided callback", async () => {
    runChat.mockImplementationOnce(async (request) => {
      request.onDelta?.("part-1");
      request.onDelta?.("part-2");
      return { assistantText: "final" };
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
    expect(runChat).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [],
      }),
    );
  });

  it("propagates runtime errors", async () => {
    const handler = new ChatModeHandler(deps);
    const error = new Error("runtime unavailable");
    runChat.mockRejectedValueOnce(error);

    await expect(handler.respond(input)).rejects.toThrow(error);
  });
});
