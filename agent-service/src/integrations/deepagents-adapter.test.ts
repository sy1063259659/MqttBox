import { beforeEach, describe, expect, it, vi } from "vitest";
import { TypedEventBus } from "../harness/event-bus.js";
import type { ModelClient } from "../models/types.js";
import { DeepAgentsAdapter } from "./deepagents-adapter.js";

const mocks = vi.hoisted(() => {
  const createAgent = vi.fn();
  const humanInTheLoopMiddleware = vi.fn((config) => ({
    kind: "hitl-middleware",
    config,
  }));
  const createPatchToolCallsMiddleware = vi.fn(() => ({
    kind: "patch-tool-calls-middleware",
  }));
  const createDeepAgentTools = vi.fn(() => []);
  const sdkChatModel = vi.fn();

  class CommandMock {
    constructor(payload: unknown) {
      if (typeof payload === "object" && payload !== null) {
        Object.assign(this, payload);
      }
    }
  }

  class MemorySaverMock {}

  return {
    createAgent,
    humanInTheLoopMiddleware,
    createPatchToolCallsMiddleware,
    createDeepAgentTools,
    sdkChatModel,
    CommandMock,
    MemorySaverMock,
  };
});

vi.mock("langchain", () => ({
  createAgent: mocks.createAgent,
  humanInTheLoopMiddleware: mocks.humanInTheLoopMiddleware,
}));

vi.mock("deepagents", () => ({
  createPatchToolCallsMiddleware: mocks.createPatchToolCallsMiddleware,
}));

vi.mock("./deepagents-tool-bridge.js", () => ({
  createDeepAgentTools: mocks.createDeepAgentTools,
}));

vi.mock("../models/openai-deepagents-chat-model.js", () => ({
  OpenAIDeepAgentsChatModel: class {
    constructor(options: unknown) {
      mocks.sdkChatModel(options);
    }
  },
}));

vi.mock("@langchain/langgraph", () => ({
  Command: mocks.CommandMock,
}));

vi.mock("@langchain/langgraph-checkpoint", () => ({
  MemorySaver: mocks.MemorySaverMock,
}));

vi.mock("@langchain/core/tools", () => ({
  tool: (handler: (input: unknown) => Promise<unknown>, options: Record<string, unknown>) => ({
    ...options,
    invoke: handler,
  }),
}));

function createModelClient(): ModelClient {
  return {
    provider: "openai",
    generate: vi.fn(),
    configure: vi.fn(),
    getRuntimeConfig: vi.fn(() => ({
      provider: "openai",
      enabled: true,
      apiKey: "test-key",
      baseUrl: "https://example.com/v1",
      model: "gpt-5.4",
    })),
    getConfigSummary: vi.fn(() => ({
      provider: "openai",
      configured: true,
      model: "gpt-5.4",
      baseUrl: "https://example.com/v1",
      enabled: true,
    })),
  };
}

function createBaseInput() {
  return {
    sessionId: "session-1",
    runId: "run-1",
    systemPrompt: "You are the parser authoring agent.",
    userMessage: "Write a parser for a 2-byte temperature frame.",
    attachments: [],
    eventBus: new TypedEventBus(),
    toolRunner: {
      execute: vi.fn(),
    } as never,
    toolDefinitions: [],
    modelClient: createModelClient(),
    capabilityId: "parser-authoring" as const,
    suggestedTopicFilter: "devices/temperature",
  };
}

function createInterruptState() {
  return {
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: "Draft ready for approval." }],
      },
    ],
    __interrupt__: [
      {
        value: {
          actionRequests: [
            {
              name: "capture_parser_artifact",
              args: {
                name: "Temperature Parser",
                script:
                  "function parse(input, helpers) { return { temperature: helpers.readInt16BE(input.bytes, 0) / 10 }; }",
              },
              description: "Review the generated parser draft.",
            },
          ],
          reviewConfigs: [
            {
              actionName: "capture_parser_artifact",
              allowedDecisions: ["approve", "reject"],
              description: "Confirm before saving the parser artifact.",
            },
          ],
        },
      },
    ],
  };
}

function createArtifactCandidate() {
  return {
    name: "Temperature Parser",
    script: [
      "function parse(input, helpers) {",
      "  return {",
      "    temperature: helpers.readInt16BE(input.bytes, 0) / 10,",
      "  };",
      "}",
    ].join("\n"),
    suggestedTopicFilter: "devices/temperature",
    suggestedTestPayloadHex: "00FA",
    summary: "Parses a signed 16-bit temperature value.",
    assumptions: ["Offset 0 contains a signed 16-bit big-endian temperature value."],
    risks: ["Scaling may differ if the device firmware changes."],
    nextSteps: ["Verify with a real payload sample from the broker."],
    sourceSampleSummary: "2-byte signed temperature payload",
  };
}

function createManualArtifactCandidate() {
  return {
    name: "Temperature Parser",
    script: [
      "function parse(input, helpers) {",
      "  const bytes = input.bytes;",
      "  const raw = (bytes[0] << 8) | bytes[1];",
      "  return {",
      "    temperature: raw / 10,",
      "  };",
      "}",
    ].join("\n"),
    suggestedTopicFilter: "devices/temperature",
    suggestedTestPayloadHex: "00FA",
    summary:
      "This draft reads the first two bytes, interprets them as a temperature, and returns a JSON object that can be reviewed in the parser library.",
    assumptions: [
      "The first two bytes are a big-endian temperature value scaled by ten.",
      "The payload always contains at least two bytes.",
      "No status flag bytes precede the temperature value.",
    ],
    risks: [
      "Endian may be wrong.",
      "Scaling may differ by firmware.",
      "Field naming may need a product-specific rename.",
    ],
    nextSteps: [
      "Open the parser library.",
      "Verify against a real payload.",
      "Check firmware docs.",
    ],
    sourceSampleSummary: "2-byte signed temperature payload",
  };
}

describe("DeepAgentsAdapter", () => {
  beforeEach(() => {
    mocks.createAgent.mockReset();
    mocks.humanInTheLoopMiddleware.mockClear();
    mocks.createPatchToolCallsMiddleware.mockClear();
    mocks.createDeepAgentTools.mockReset();
    mocks.sdkChatModel.mockClear();
    mocks.createDeepAgentTools.mockReturnValue([]);
  });

  it("uses DeepAgents HITL for parser authoring approval and resumes the exact thread after approval", async () => {
    const interruptState = createInterruptState();
    const artifactCandidate = createArtifactCandidate();
    const onDelta = vi.fn();

    const initialAgent = {
      stream: vi.fn(async () => {
        return (async function* () {
          yield ["values", interruptState] as const;
        })();
      }),
    };
    const resumedAgent = {
      stream: vi.fn(async () => {
        const captureTool = (
          mocks.createAgent.mock.calls[1]?.[0] as {
            tools?: Array<{ name?: string; invoke?: (input: unknown) => Promise<unknown> }>;
          }
        )?.tools?.find((candidate) => candidate.name === "capture_parser_artifact");

        await captureTool?.invoke?.(artifactCandidate);

        return (async function* () {
          yield [
            "messages",
            [
              {
                role: "assistant",
                content: [{ type: "text", text: "Parser draft approved and ready." }],
              },
            ],
          ] as const;
          yield [
            "values",
            {
              messages: [
                {
                  role: "assistant",
                  content: [{ type: "text", text: "Parser draft approved and ready." }],
                },
              ],
            },
          ] as const;
        })();
      }),
    };

    mocks.createAgent
      .mockReturnValueOnce(initialAgent)
      .mockReturnValueOnce(resumedAgent);

    const adapter = new DeepAgentsAdapter({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as never);

    const firstResult = await adapter.runExecute({
      ...createBaseInput(),
      safetyLevel: "confirm",
      onDelta,
    });

    expect(firstResult).toMatchObject({
      assistantText: "Draft ready for approval.",
      approvalInterrupt: {
        threadId: "run-1",
        toolName: "capture_parser_artifact",
        description: "Review the generated parser draft.",
        allowedDecisions: ["approve", "reject"],
      },
    });
    expect(onDelta).not.toHaveBeenCalled();
    expect(initialAgent.stream).toHaveBeenCalledWith(
      {
        messages: [
          expect.objectContaining({
            content: [{ type: "text", text: "Write a parser for a 2-byte temperature frame." }],
          }),
        ],
      },
      {
        configurable: {
          thread_id: "run-1",
        },
        streamMode: ["messages", "values"],
      },
    );
    expect(mocks.createAgent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        checkpointer: expect.any(mocks.MemorySaverMock),
        middleware: expect.arrayContaining([
          expect.objectContaining({ kind: "patch-tool-calls-middleware" }),
          expect.objectContaining({ kind: "hitl-middleware" }),
        ]),
      }),
    );
    expect(mocks.humanInTheLoopMiddleware).toHaveBeenNthCalledWith(1, {
      interruptOn: {
        capture_parser_artifact: {
          allowedDecisions: ["approve", "reject"],
          description: expect.stringContaining("devices/temperature"),
        },
      },
    });

    const resumedResult = await adapter.resumeExecute({
      ...createBaseInput(),
      threadId: "run-1",
      safetyLevel: "confirm",
      onDelta,
    });

    expect(resumedAgent.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        resume: {
          decisions: [{ type: "approve" }],
        },
      }),
      {
        configurable: {
          thread_id: "run-1",
        },
        streamMode: ["messages", "values"],
      },
    );
    expect(onDelta).toHaveBeenCalledWith("Parser draft approved and ready.");
    expect(resumedResult).toMatchObject({
      assistantText: "Parser draft approved and ready.",
      artifactCandidate: expect.objectContaining({
        ...artifactCandidate,
        script: expect.stringContaining("helpers.readInt16BE(bytes, 0) / 10"),
      }),
    });
    expect(mocks.sdkChatModel).toHaveBeenCalledTimes(2);
  });

  it("treats HTML gateway pages as provider errors instead of assistant replies", async () => {
    const htmlGatewayPage = [
      "<!DOCTYPE html>",
      "<html>",
      "<head><title>502 Bad gateway</title></head>",
      "<body>cloudflare error code 502</body>",
      "</html>",
    ].join("");

    mocks.createAgent.mockReturnValueOnce({
      stream: vi.fn(async () => {
        return (async function* () {
          yield [
            "messages",
            [
              {
                role: "assistant",
                content: [{ type: "text", text: htmlGatewayPage }],
              },
            ],
          ] as const;
          yield [
            "values",
            {
              messages: [
                {
                  role: "assistant",
                  content: [{ type: "text", text: htmlGatewayPage }],
                },
              ],
            },
          ] as const;
        })();
      }),
    });

    const adapter = new DeepAgentsAdapter({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as never);

    await expect(
      adapter.runChat({
        sessionId: "session-1",
        runId: "run-1",
        systemPrompt: "You are a helpful MQTT assistant.",
        userMessage: "Say hello",
        attachments: [],
        eventBus: new TypedEventBus(),
        toolRunner: {
          execute: vi.fn(),
        } as never,
        toolDefinitions: [],
        modelClient: createModelClient(),
      }),
    ).rejects.toMatchObject({
      code: "openai_request_failed",
      message:
        "The configured OpenAI-compatible API returned an HTML gateway error page. Check the API base URL or upstream gateway status.",
    });
  });

  it("repairs helper-less parser drafts and condenses verbose parser summaries", async () => {
    const manualCandidate = createManualArtifactCandidate();
    const repairedCandidate = createArtifactCandidate();
    const modelClient = createModelClient();
    const generateMock = vi.mocked(modelClient.generate);

    generateMock.mockResolvedValueOnce({
      content: [
        "<artifact_candidate>",
        JSON.stringify(repairedCandidate),
        "</artifact_candidate>",
      ].join(""),
    });

    mocks.createAgent.mockReturnValueOnce({
      stream: vi.fn(async () => {
        const captureTool = (
          mocks.createAgent.mock.calls[0]?.[0] as {
            tools?: Array<{ name?: string; invoke?: (input: unknown) => Promise<unknown> }>;
          }
        )?.tools?.find((candidate) => candidate.name === "capture_parser_artifact");

        await captureTool?.invoke?.(manualCandidate);

        return (async function* () {
          yield [
            "messages",
            [
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text:
                      "I inspected the payload layout and drafted a parser for the first two bytes. The current draft still needs validation against real broker samples before you save it to the parser library. I also noted that the firmware might use a different scale factor.",
                  },
                ],
              },
            ],
          ] as const;
          yield [
            "values",
            {
              messages: [
                {
                  role: "assistant",
                  content: [
                    {
                      type: "text",
                      text:
                        "I inspected the payload layout and drafted a parser for the first two bytes. The current draft still needs validation against real broker samples before you save it to the parser library. I also noted that the firmware might use a different scale factor.",
                    },
                  ],
                },
              ],
            },
          ] as const;
        })();
      }),
    });

    const adapter = new DeepAgentsAdapter({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as never);

    const result = await adapter.runExecute({
      ...createBaseInput(),
      modelClient,
      safetyLevel: "draft",
    });

    expect(result.assistantText).toBe(
      "I inspected the payload layout and drafted a parser for the first two bytes. The current draft still needs validation against real broker samples before you save it to the parser library.",
    );
    expect(result.artifactCandidate).toMatchObject({
      script: expect.stringContaining("helpers.readInt16BE"),
      assumptions: ["Offset 0 contains a signed 16-bit big-endian temperature value."],
      risks: ["Scaling may differ if the device firmware changes."],
      nextSteps: ["Verify with a real payload sample from the broker."],
    });
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("You repair MQTT parser draft artifacts."),
        userMessage: expect.stringContaining('"script": "function parse(input, helpers) {\\n  const bytes = Array.isArray(input.bytes) && input.bytes.length > 0 ? input.bytes : helpers.hexToBytes(input.payloadHex);'),
      }),
    );
  });
});
