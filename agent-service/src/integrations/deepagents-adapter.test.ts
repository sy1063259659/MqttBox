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
      protocol: "responses" as const,
    })),
    getConfigSummary: vi.fn(() => ({
      provider: "openai",
      configured: true,
      model: "gpt-5.4",
      baseUrl: "https://example.com/v1",
      enabled: true,
      protocol: "responses" as const,
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

function createImageAttachment() {
  return {
    id: "attachment-1",
    kind: "image" as const,
    source: "paste" as const,
    mimeType: "image/png",
    filename: "protocol.png",
    dataUrl: "data:image/png;base64,AAAA",
    byteSize: 4,
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

function createLittleEndianBitfieldCandidate() {
  return {
    name: "Status Parser",
    script: [
      "function parse(input, helpers) {",
      "  const bytes = input.bytes;",
      "  const voltageMv = (bytes[1] << 8) | bytes[0];",
      "  const status = bytes[2];",
      "  return {",
      "    voltageMv,",
      "    alarmFlags: status,",
      "  };",
      "}",
    ].join("\n"),
    suggestedTopicFilter: "devices/status",
    suggestedTestPayloadHex: "D20405",
    summary: "Generated parser draft for review.",
    assumptions: ["Generated draft needs review."],
    risks: ["Generated draft needs validation."],
    nextSteps: ["Open the parser library."],
    sourceSampleSummary: "Protocol image and request.",
  };
}

function createLittleEndianBitfieldRepairedCandidate() {
  return {
    name: "Status Parser",
    script: [
      "function parse(input, helpers) {",
      "  const bytes = Array.isArray(input.bytes) && input.bytes.length > 0 ? input.bytes : helpers.hexToBytes(input.payloadHex);",
      "  const statusByte = helpers.readUint8(bytes, 2);",
      "  return {",
      "    voltageMv: helpers.readUint16LE(bytes, 0),",
      "    alarmCode: helpers.bits(statusByte, 0, 3),",
      "    alarmActive: helpers.bit(statusByte, 3),",
      "  };",
      "}",
    ].join("\n"),
    suggestedTopicFilter: "devices/status",
    suggestedTestPayloadHex: "D20405",
    summary: "Parses a little-endian voltage field and status bits.",
    assumptions: ["Bytes 0-1 store voltage in little-endian order."],
    risks: ["Bit numbering should be verified against a live status sample."],
    nextSteps: ["Test D20405 in Parser Library and compare the alarm bits."],
    sourceSampleSummary: "Request plus attached protocol image for a 3-byte status frame.",
  };
}

function createTelemetryParserCandidate() {
  return {
    name: "Gateway Telemetry Parser",
    script: [
      "function parse(input, helpers) {",
      "  const bytes = Array.isArray(input.bytes) && input.bytes.length > 0 ? input.bytes : helpers.hexToBytes(input.payloadHex);",
      "  if (!helpers.startsWithBytes(bytes, [0x78, 0x78])) {",
      "    throw new Error('Unexpected frame header');",
      "  }",
      "  const statusByte = helpers.readUint8(bytes, 8);",
      "  return {",
      "    frameLength: helpers.readUint8(bytes, 2),",
      "    deviceTime: helpers.unixSeconds(helpers.readUint32LE(bytes, 3)),",
      "    batteryMv: helpers.readUint16LE(bytes, 7),",
      "    gpsFix: helpers.bit(statusByte, 0),",
      "    alarmCode: helpers.bits(statusByte, 1, 3),",
      "    checksumHex: helpers.sliceHex(bytes, 9, 2),",
      "  };",
      "}",
    ].join("\n"),
    suggestedTopicFilter: "trackers/telemetry/raw",
    suggestedTestPayloadHex: "78780C5F3759DFB80B0528AF",
    summary: "Generated parser draft for review in the parser library.",
    assumptions: ["Generated draft needs review."],
    risks: ["Payload layout needs validation."],
    nextSteps: ["Open the parser library."],
    sourceSampleSummary: "Generated draft.",
  };
}

function createAsciiTimestampCandidate() {
  return {
    name: "Access Event Parser",
    script: [
      "function parse(input, helpers) {",
      "  const bytes = Array.isArray(input.bytes) && input.bytes.length > 0 ? input.bytes : helpers.hexToBytes(input.payloadHex);",
      "  return {",
      "    readerId: helpers.readAscii(bytes, 0, 6),",
      "    eventTime: helpers.unixSeconds(helpers.readUint32BE(bytes, 6)),",
      "    eventCode: helpers.readUint8(bytes, 10),",
      "    doorOpen: helpers.bit(helpers.readUint8(bytes, 11), 0),",
      "    crcHex: helpers.sliceHex(bytes, 12, 2),",
      "  };",
      "}",
    ].join("\n"),
    suggestedTopicFilter: "access/events/raw",
    suggestedTestPayloadHex: "5244523030316615B7800301A1B2",
    summary: "Generated parser draft for the JSON object.",
    assumptions: ["Generated draft needs review."],
    risks: ["Generated draft needs validation."],
    nextSteps: ["Open the parser library."],
    sourceSampleSummary: "Generated draft.",
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
      "I inspected the payload layout and drafted a parser for the first two bytes.\n\nThe current draft still needs validation against real broker samples before you save it to the parser library.",
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

  it("repairs little-endian bitfield drafts with explicit helper usage", async () => {
    const manualCandidate = createLittleEndianBitfieldCandidate();
    const repairedCandidate = createLittleEndianBitfieldRepairedCandidate();
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
                content: [{ type: "text", text: "Drafted a status parser and kept the response compact." }],
              },
            ],
          ] as const;
          yield [
            "values",
            {
              messages: [
                {
                  role: "assistant",
                  content: [{ type: "text", text: "Drafted a status parser and kept the response compact." }],
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
      userMessage:
        "Write a parser for topic devices/status. Bytes 0-1 are little-endian voltage in mV and byte 2 contains status bits 0-2 plus an alarm flag on bit 3.",
      attachments: [createImageAttachment()],
      modelClient,
      suggestedTopicFilter: "devices/status",
      safetyLevel: "draft",
    });

    expect(result.artifactCandidate).toMatchObject({
      script: expect.stringContaining("helpers.readUint16LE(bytes, 0)"),
    });
    expect(result.artifactCandidate?.script).toContain("helpers.bits(statusByte, 0, 3)");
    expect(result.artifactCandidate?.script).toContain("helpers.bit(statusByte, 3)");
    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("Retrieved helper context:"),
      }),
    );
    expect(mocks.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("readUint16LE(bytes, offset)"),
      }),
    );
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("Prefer a partial but specific parser"),
        userMessage: expect.stringContaining("Multi-byte fields likely use little-endian (LE)."),
      }),
    );
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: expect.stringContaining(
          "The request mentions status bits or flags, so the parser should expose them with helpers.bit/helpers.bits.",
        ),
      }),
    );
  });

  it("fails parser authoring when helper repair still does not satisfy the helper contract", async () => {
    const manualCandidate = createLittleEndianBitfieldCandidate();
    const modelClient = createModelClient();
    const generateMock = vi.mocked(modelClient.generate);

    generateMock.mockResolvedValueOnce({
      content: [
        "<artifact_candidate>",
        JSON.stringify(manualCandidate),
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
                content: [{ type: "text", text: "Drafted a status parser." }],
              },
            ],
          ] as const;
          yield [
            "values",
            {
              messages: [
                {
                  role: "assistant",
                  content: [{ type: "text", text: "Drafted a status parser." }],
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
      adapter.runExecute({
        ...createBaseInput(),
        userMessage:
          "Write a parser for topic devices/status. Bytes 0-1 are little-endian voltage in mV and byte 2 contains status bits 0-2 plus an alarm flag on bit 3.",
        modelClient,
        suggestedTopicFilter: "devices/status",
        safetyLevel: "draft",
      }),
    ).rejects.toThrow(/built-in helper requirements/i);

    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it("replaces generic parser metadata with concrete summaries and image evidence", async () => {
    const genericCandidate = {
      name: "Status Parser",
      script: [
        "function parse(input, helpers) {",
        "  const bytes = input.bytes;",
        "  const statusByte = helpers.readUint8(bytes, 2);",
        "  return {",
        "    voltageMv: helpers.readUint16LE(bytes, 0),",
        "    alarmCode: helpers.bits(statusByte, 0, 3),",
        "  };",
        "}",
      ].join("\n"),
      suggestedTopicFilter: "devices/status",
      suggestedTestPayloadHex: "D20405",
      summary: "Generated parser draft for review in the parser library.",
      assumptions: ["Generated draft needs review."],
      risks: ["Payload layout needs validation."],
      nextSteps: ["Open the parser library."],
      sourceSampleSummary: "Generated draft.",
    };

    mocks.createAgent.mockReturnValueOnce({
      stream: vi.fn(async () => {
        const captureTool = (
          mocks.createAgent.mock.calls[0]?.[0] as {
            tools?: Array<{ name?: string; invoke?: (input: unknown) => Promise<unknown> }>;
          }
        )?.tools?.find((candidate) => candidate.name === "capture_parser_artifact");

        await captureTool?.invoke?.(genericCandidate);

        return (async function* () {
          yield [
            "messages",
            [
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: "I drafted a parser from the request and protocol image, and it should now be ready for review in the parser library after you validate the byte mapping.",
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
                      text: "I drafted a parser from the request and protocol image, and it should now be ready for review in the parser library after you validate the byte mapping.",
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
      userMessage:
        "Use the attached image to write a parser for topic devices/status. Bytes 0-1 are little-endian voltage and byte 2 contains alarm bits.",
      attachments: [createImageAttachment()],
      suggestedTopicFilter: "devices/status",
      safetyLevel: "draft",
    });

    expect(result.assistantText).toBe(
      "I drafted a parser from the request and protocol image, and it should now be ready for review in the parser library after you validate the byte mapping.",
    );
    expect(result.artifactCandidate).toMatchObject({
      summary: expect.stringContaining("devices/status"),
      sourceSampleSummary: "Inferred from the request and 1 attached protocol image(s).",
    });
    expect(result.artifactCandidate?.summary).toContain("little-endian");
    expect(result.artifactCandidate?.summary).toContain("status bits");
    expect(result.artifactCandidate?.assumptions?.[0]).toContain("little-endian");
    expect(result.artifactCandidate?.risks?.join(" ")).toContain("live payload");
    expect(result.artifactCandidate?.nextSteps?.[0]).toContain("D20405");
  });

  it("normalizes a realistic telemetry parser sample into concrete review metadata", async () => {
    const telemetryCandidate = createTelemetryParserCandidate();

    mocks.createAgent.mockReturnValueOnce({
      stream: vi.fn(async () => {
        const captureTool = (
          mocks.createAgent.mock.calls[0]?.[0] as {
            tools?: Array<{ name?: string; invoke?: (input: unknown) => Promise<unknown> }>;
          }
        )?.tools?.find((candidate) => candidate.name === "capture_parser_artifact");

        await captureTool?.invoke?.(telemetryCandidate);

        return (async function* () {
          yield [
            "messages",
            [
              {
                role: "assistant",
                content: [{ type: "text", text: "Built a telemetry parser for the tracker frame." }],
              },
            ],
          ] as const;
          yield [
            "values",
            {
              messages: [
                {
                  role: "assistant",
                  content: [{ type: "text", text: "Built a telemetry parser for the tracker frame." }],
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
      userMessage:
        "Write a parser for topic trackers/telemetry/raw. Frame starts with 0x7878, bytes 3-6 are a little-endian unix timestamp, bytes 7-8 are battery mV, byte 8 contains GPS and alarm status bits, and the last 2 bytes are checksum.",
      suggestedTopicFilter: "trackers/telemetry/raw",
      safetyLevel: "draft",
    });

    expect(result.artifactCandidate?.summary).toContain("trackers/telemetry/raw");
    expect(result.artifactCandidate?.summary).toContain("validates frame headers");
    expect(result.artifactCandidate?.summary).toContain("formats timestamps");
    expect(result.artifactCandidate?.summary).toContain("extracts status bits");
    expect(result.artifactCandidate?.sourceSampleSummary).toContain("Frame starts with 0x7878");
    expect(result.artifactCandidate?.nextSteps?.[0]).toContain("78780C5F3759DFB80B0528AF");
  });

  it("keeps realistic text-and-timestamp parser samples concise without generic wording", async () => {
    const accessCandidate = createAsciiTimestampCandidate();

    mocks.createAgent.mockReturnValueOnce({
      stream: vi.fn(async () => {
        const captureTool = (
          mocks.createAgent.mock.calls[0]?.[0] as {
            tools?: Array<{ name?: string; invoke?: (input: unknown) => Promise<unknown> }>;
          }
        )?.tools?.find((candidate) => candidate.name === "capture_parser_artifact");

        await captureTool?.invoke?.(accessCandidate);

        return (async function* () {
          yield [
            "messages",
            [
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: "Drafted an access event parser with reader ID, timestamp, event code, and a retained CRC field for follow-up verification.",
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
                      text: "Drafted an access event parser with reader ID, timestamp, event code, and a retained CRC field for follow-up verification.",
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
      userMessage:
        "Create a parser for topic access/events/raw. Bytes 0-5 are the ASCII reader ID, bytes 6-9 are a big-endian unix timestamp, byte 10 is the event code, byte 11 bit 0 means the door is open, and bytes 12-13 are CRC.",
      suggestedTopicFilter: "access/events/raw",
      safetyLevel: "draft",
    });

    expect(result.assistantText).toBe(
      "Drafted an access event parser with reader ID, timestamp, event code, and a retained CRC field for follow-up verification.",
    );
    expect(result.artifactCandidate?.summary).toContain("access/events/raw");
    expect(result.artifactCandidate?.summary).toContain("decodes ASCII text");
    expect(result.artifactCandidate?.summary).toContain("formats timestamps");
    expect(result.artifactCandidate?.script).toContain("helpers.readUint32BE(bytes, 6)");
    expect(result.artifactCandidate?.assumptions?.join(" ")).not.toContain("Generated draft");
    expect(result.artifactCandidate?.risks?.join(" ")).toContain("live payload");
  });
});
