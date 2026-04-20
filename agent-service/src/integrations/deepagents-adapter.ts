import type { AgentAttachmentDto, AgentSafetyLevel } from "@agent-contracts";
import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { Command } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { createAgent, humanInTheLoopMiddleware } from "langchain";
import { createPatchToolCallsMiddleware } from "deepagents";
import { z } from "zod";
import { createDeepAgentTools } from "./deepagents-tool-bridge.js";
import type { TypedEventBus } from "../harness/event-bus.js";
import { OpenAIDeepAgentsChatModel } from "../models/openai-deepagents-chat-model.js";
import { ModelClientError, type ModelClient, type ModelRequest } from "../models/types.js";
import type { Logger } from "../observability/logger.js";
import type { ToolDefinition, ToolRunner } from "../tools/index.js";
import {
  listParserHelpers,
  PARSER_HELPER_USAGE_NOTE,
  type ParserHelperReference,
} from "../tools/parser-helpers.js";

const PARSER_ARTIFACT_TOOL_NAME = "capture_parser_artifact";
const PARSER_ARTIFACT_APPROVAL_DECISIONS = ["approve", "reject"] as const;
const PARSER_CONCISE_REPLY_MAX_CHARS = 320;
const PARSER_CONCISE_REPLY_MAX_LINES = 4;
const PARSER_CONCISE_REPLY_MAX_SENTENCES = 2;
const PARSER_BYTES_BOOTSTRAP_LINE =
  "const bytes = Array.isArray(input.bytes) && input.bytes.length > 0 ? input.bytes : helpers.hexToBytes(input.payloadHex);";
const PARSER_HELPER_CHEAT_SHEET = listParserHelpers([
  "hexToBytes",
  "readUint8",
  "readInt8",
  "readUint16BE",
  "readUint16LE",
  "readInt16BE",
  "readInt16LE",
  "readUint32BE",
  "readUint32LE",
  "readInt32BE",
  "readInt32LE",
  "readUint64BE",
  "readUint64LE",
  "readInt64BE",
  "readInt64LE",
  "readFloat32BE",
  "readFloat32LE",
  "readFloat64BE",
  "readFloat64LE",
  "bit",
  "bits",
  "sliceHex",
  "bytesToHex",
  "readAscii",
  "readUtf8",
  "readBcd",
  "startsWithBytes",
  "unixSeconds",
  "unixMillis",
])
  .map((helper) => `${helper.signature}: ${helper.description}`)
  .join(" | ");
const PARSER_GENERIC_TEXT_PATTERN =
  /\b(parser draft|generated draft|json object|open the parser library|needs human review|needs validation|review in parser library|payload layout)\b/i;

const parserArtifactCandidateSchema = z.object({
  name: z.string().min(1),
  script: z.string().min(1),
  suggestedTopicFilter: z.string().min(1).optional(),
  suggestedTestPayloadHex: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  assumptions: z.array(z.string().min(1)).optional(),
  risks: z.array(z.string().min(1)).optional(),
  nextSteps: z.array(z.string().min(1)).optional(),
  sourceSampleSummary: z.string().min(1).optional(),
});

export type ParserArtifactCandidate = z.infer<typeof parserArtifactCandidateSchema>;

export interface DeepAgentsChatInput {
  sessionId: string;
  runId?: string | null;
  systemPrompt: string;
  userMessage: string;
  attachments?: AgentAttachmentDto[];
  onDelta?: (delta: string) => void;
  eventBus: TypedEventBus;
  toolRunner: ToolRunner;
  toolDefinitions: ToolDefinition[];
  modelClient: ModelClient;
}

export interface DeepAgentsExecuteInput extends DeepAgentsChatInput {
  capabilityId?: string | null;
  runId?: string | null;
  safetyLevel?: AgentSafetyLevel;
  suggestedTopicFilter?: string | null;
}

export interface DeepAgentsResumeExecuteInput extends DeepAgentsExecuteInput {
  threadId: string;
}

export interface DeepAgentsChatResult {
  assistantText: string;
}

export interface DeepAgentsApprovalInterrupt {
  threadId: string;
  toolName: string;
  toolArgs: unknown;
  description: string | null;
  allowedDecisions: Array<(typeof PARSER_ARTIFACT_APPROVAL_DECISIONS)[number] | "edit">;
}

export interface DeepAgentsExecuteResult extends DeepAgentsChatResult {
  artifactCandidate?: ParserArtifactCandidate;
  approvalInterrupt?: DeepAgentsApprovalInterrupt;
}

type ImageContentBlock = {
  type: "image_url";
  image_url: { url: string };
};

type TextContentBlock = {
  type: "text";
  text: string;
};

type DeepAgentStreamState = Record<string, unknown> | null;
type DeepAgentRuntime = ReturnType<typeof createAgent>;
type RuntimeInterruptConfig = Record<
  string,
  {
    allowedDecisions: Array<(typeof PARSER_ARTIFACT_APPROVAL_DECISIONS)[number] | "edit">;
    description: string;
  }
>;

interface ParserRequestSignals {
  endianHint: "be" | "le" | null;
  mentionsBitFields: boolean;
  mentionsText: boolean;
  mentionsBcd: boolean;
  mentionsTimestamp: boolean;
  mentionsFloat: boolean;
  mentionsChecksum: boolean;
  attachmentCount: number;
}

interface ParserHelperRetrieval {
  relevantHelpers: ParserHelperReference[];
  helperUsageRules: string[];
  helperReminders: string[];
}

class ParserHelperComplianceError extends Error {
  constructor(message: string, readonly violations: string[]) {
    super(message);
    this.name = "ParserHelperComplianceError";
  }
}

export class DeepAgentsAdapter {
  readonly runtime = "deepagentsjs";
  private readonly checkpointer = new MemorySaver();

  constructor(private readonly logger: Logger) {}

  async initialize(): Promise<void> {
    this.logger.info("deepagents runtime initialized");
  }

  async runChat(input: DeepAgentsChatInput): Promise<DeepAgentsChatResult> {
    return {
      assistantText: await this.runDeepAgentText(input),
    };
  }

  async runExecute(input: DeepAgentsExecuteInput): Promise<DeepAgentsExecuteResult> {
    if (input.capabilityId === "parser-authoring") {
      return this.runParserAuthoring(input);
    }

    return {
      assistantText: await this.runDeepAgentText(input),
    };
  }

  async resumeExecute(input: DeepAgentsResumeExecuteInput): Promise<DeepAgentsExecuteResult> {
    if (input.capabilityId === "parser-authoring") {
      return this.resumeParserAuthoring(input);
    }

    return {
      assistantText: await this.runDeepAgentText(input),
    };
  }

  private async runParserAuthoring(input: DeepAgentsExecuteInput): Promise<DeepAgentsExecuteResult> {
    let artifactCandidate: ParserArtifactCandidate | undefined;
    const captureParserArtifact = tool(
      async (candidate: ParserArtifactCandidate) => {
        artifactCandidate = candidate;
        return "Parser artifact candidate captured.";
      },
      {
        name: PARSER_ARTIFACT_TOOL_NAME,
        description:
          "Capture the final parser draft candidate with JavaScript script, review notes, and suggested topic metadata.",
        schema: parserArtifactCandidateSchema,
      },
    );

    try {
      const agent = this.createParserAuthoringAgent(input, captureParserArtifact, {
        interruptOnCapture: input.safetyLevel === "confirm",
      });
      const { assistantText, finalState } = await this.executeAgent(
        agent,
        {
          messages: [this.createHumanMessage(input.userMessage, input.attachments)],
        },
        {
          threadId: input.safetyLevel === "confirm" ? input.runId ?? null : null,
          onDelta: input.safetyLevel === "confirm" ? undefined : input.onDelta,
        },
      );

      if (input.safetyLevel === "confirm") {
        const approvalInterrupt = this.extractApprovalInterrupt(finalState, input.runId ?? null);
        if (approvalInterrupt) {
          return {
            assistantText: this.extractAssistantText(finalState),
            approvalInterrupt,
          };
        }
      }

      const normalizedAssistantText = this.ensureText(
        assistantText || this.extractAssistantText(finalState),
      );
      const normalizedArtifactCandidate = artifactCandidate
        ? await this.finalizeParserArtifactCandidate(input, artifactCandidate)
        : undefined;

      return normalizedArtifactCandidate
        ? {
            assistantText: condenseParserAssistantText(normalizedAssistantText),
            artifactCandidate: normalizedArtifactCandidate,
          }
        : { assistantText: condenseParserAssistantText(normalizedAssistantText) };
    } catch (error) {
      if (error instanceof ParserHelperComplianceError) {
        throw error;
      }
      this.logger.warn("deepagents parser-authoring run failed, falling back to direct model call", {
        error: toErrorMessage(error),
      });
      return this.fallbackParserAuthoring(input);
    }
  }

  private async resumeParserAuthoring(
    input: DeepAgentsResumeExecuteInput,
  ): Promise<DeepAgentsExecuteResult> {
    let artifactCandidate: ParserArtifactCandidate | undefined;
    const captureParserArtifact = tool(
      async (candidate: ParserArtifactCandidate) => {
        artifactCandidate = candidate;
        return "Parser artifact candidate captured.";
      },
      {
        name: PARSER_ARTIFACT_TOOL_NAME,
        description:
          "Capture the final parser draft candidate with JavaScript script, review notes, and suggested topic metadata.",
        schema: parserArtifactCandidateSchema,
      },
    );

    const agent = this.createParserAuthoringAgent(input, captureParserArtifact, {
      interruptOnCapture: true,
    });
    const { assistantText, finalState } = await this.executeAgent(
      agent,
      new Command({
        resume: {
          decisions: [{ type: "approve" }],
        },
      }),
      {
        threadId: input.threadId,
        onDelta: input.onDelta,
      },
    );
    const approvalInterrupt = this.extractApprovalInterrupt(finalState, input.threadId);
    if (approvalInterrupt) {
      return {
        assistantText: assistantText.trim(),
        approvalInterrupt,
      };
    }

    const normalizedAssistantText = this.ensureText(
      assistantText || this.extractAssistantText(finalState),
    );
    const normalizedArtifactCandidate = artifactCandidate
      ? await this.finalizeParserArtifactCandidate(input, artifactCandidate)
      : undefined;

    return normalizedArtifactCandidate
      ? {
          assistantText: condenseParserAssistantText(normalizedAssistantText),
          artifactCandidate: normalizedArtifactCandidate,
        }
      : { assistantText: condenseParserAssistantText(normalizedAssistantText) };
  }

  private async runDeepAgentText(
    input: DeepAgentsChatInput,
    options: {
      tools?: unknown[];
      extraSystemPrompt?: string;
    } = {},
  ): Promise<string> {
    const runtimeTools = createDeepAgentTools({
      sessionId: input.sessionId,
      runId: input.runId ?? null,
      eventBus: input.eventBus,
      toolRunner: input.toolRunner,
      toolDefinitions: input.toolDefinitions,
    });

    const agent = this.createRuntimeAgent({
      modelClient: input.modelClient,
      systemPrompt: [input.systemPrompt, options.extraSystemPrompt].filter(Boolean).join("\n\n"),
      tools: [...runtimeTools, ...(options.tools ?? [])],
    });

    const { assistantText, finalState } = await this.executeAgent(
      agent,
      {
        messages: [this.createHumanMessage(input.userMessage, input.attachments)],
      },
      {
        threadId: input.runId ?? null,
        onDelta: input.onDelta,
      },
    );

    return this.ensureText(assistantText || this.extractAssistantText(finalState));
  }

  private async executeAgent(
    agent: DeepAgentRuntime,
    payload: unknown,
    options: {
      threadId?: string | null;
      onDelta?: (delta: string) => void;
    } = {},
  ): Promise<{
    assistantText: string;
    finalState: DeepAgentStreamState;
  }> {
    const config = options.threadId
      ? {
          configurable: {
            thread_id: options.threadId,
          },
        }
      : {};

    const stream = await agent.stream(
      payload as never,
      {
        ...config,
        streamMode: ["messages", "values"],
      },
    );

    let assistantText = "";
    let finalState: DeepAgentStreamState = null;

    for await (const chunk of stream) {
      if (!Array.isArray(chunk) || chunk.length < 2) {
        continue;
      }

      const [mode, payload] = chunk as [string, unknown];
      if (mode === "messages") {
        const message = Array.isArray(payload) ? payload[0] : null;
        const delta = this.extractAssistantDelta(message);
        if (!delta) {
          continue;
        }
        assistantText += delta;
        options.onDelta?.(delta);
        continue;
      }

      if (mode === "values") {
        finalState = asRecord(payload);
      }
    }

    return {
      assistantText,
      finalState,
    };
  }

  private async fallbackParserAuthoring(
    input: DeepAgentsExecuteInput,
  ): Promise<DeepAgentsExecuteResult> {
    const request = this.buildFallbackParserRequest(input);
    const response = await input.modelClient.generate(request);
    const parsed = parseTaggedParserFallback(response.content);
    const normalizedArtifactCandidate = parsed.artifactCandidate
      ? await this.finalizeParserArtifactCandidate(input, parsed.artifactCandidate)
      : undefined;

    return {
      assistantText: condenseParserAssistantText(
        this.ensureText(parsed.assistantText || response.content),
      ),
      ...(normalizedArtifactCandidate ? { artifactCandidate: normalizedArtifactCandidate } : {}),
    };
  }

  private buildFallbackParserRequest(input: DeepAgentsExecuteInput): ModelRequest {
    const helperRetrieval = retrieveRelevantParserHelpers(input);
    const requestHints = buildParserRequestHintText(input);
    return {
      mode: "execute",
      systemPrompt: [
        input.systemPrompt,
        "Return a concise plain-text explanation first, then append an artifact candidate JSON block.",
        "Use this exact format:",
        "<assistant_summary>...</assistant_summary>",
        "<artifact_candidate>{...}</artifact_candidate>",
        "The artifact_candidate JSON must contain: name, script, suggestedTopicFilter, suggestedTestPayloadHex?, summary?, assumptions?, risks?, nextSteps?, sourceSampleSummary?.",
        "Keep <assistant_summary> to 1 to 3 short plain-text paragraphs, with 1 to 2 short sentences per paragraph.",
        "Lead <assistant_summary> with the result, not with process narration.",
        "Avoid openings like I inspected, I analyzed, or I looked at unless the user explicitly asked for your process.",
        "Do not use Markdown headings, bold markers, bullet lists, numbered lists, or code fences inside <assistant_summary>.",
        "Do not use labels such as Summary, Risks, Assumptions, or Next Steps inside <assistant_summary>.",
        "Prefer a partial but specific parser over a generic draft. If some bytes are uncertain, keep them as raw hex with helpers.sliceHex/helpers.bytesToHex and say so briefly.",
        "The script must use helpers.* for binary parsing. Prefer helpers.hexToBytes, helpers.read*BE/LE, helpers.bit/bits, helpers.readAscii/readUtf8/readBcd, and helpers.unixSeconds/unixMillis instead of manual byte math when applicable.",
        `Helper reference: ${PARSER_HELPER_USAGE_NOTE}`,
        PARSER_HELPER_CHEAT_SHEET,
        formatHelperRetrievalForPrompt(helperRetrieval),
      ].join("\n\n"),
      userMessage: [
        input.userMessage,
        `Suggested topic filter: ${input.suggestedTopicFilter ?? "unknown"}`,
        requestHints,
      ].join("\n\n"),
      attachments: input.attachments,
      onDelta: input.onDelta,
    };
  }

  private createParserAuthoringAgent(
    input: DeepAgentsExecuteInput,
    captureParserArtifact: unknown,
    options: {
      interruptOnCapture: boolean;
    },
  ) {
    const runtimeTools = createDeepAgentTools({
      sessionId: input.sessionId,
      runId: input.runId ?? null,
      eventBus: input.eventBus,
      toolRunner: input.toolRunner,
      toolDefinitions: input.toolDefinitions,
    });

    return this.createRuntimeAgent({
      modelClient: input.modelClient,
      systemPrompt: [
        input.systemPrompt,
        buildParserAuthoringToolPrompt(
          input,
          retrieveRelevantParserHelpers(input),
        ),
      ]
        .filter(Boolean)
        .join("\n\n"),
      tools: [...runtimeTools, captureParserArtifact],
      ...(options.interruptOnCapture
        ? {
            checkpointer: this.checkpointer,
            interruptOn: {
              [PARSER_ARTIFACT_TOOL_NAME]: {
                allowedDecisions: [...PARSER_ARTIFACT_APPROVAL_DECISIONS],
                description: buildParserAuthoringApprovalDescription(
                  input.suggestedTopicFilter,
                  input.userMessage,
                ),
              },
            },
          }
        : {}),
    });
  }

  private createRuntimeAgent(input: {
    modelClient: ModelClient;
    systemPrompt: string;
    tools: unknown[];
    checkpointer?: MemorySaver;
    interruptOn?: RuntimeInterruptConfig;
  }) {
    return createAgent({
      model: this.buildModel(input.modelClient),
      systemPrompt: input.systemPrompt,
      ...(input.tools.length > 0 ? { tools: input.tools as never } : {}),
      middleware: [
        createPatchToolCallsMiddleware(),
        ...(input.interruptOn
          ? [
              humanInTheLoopMiddleware({
                interruptOn: input.interruptOn,
              }),
            ]
          : []),
      ],
      ...(input.checkpointer ? { checkpointer: input.checkpointer } : {}),
    });
  }

  private async finalizeParserArtifactCandidate(
    input: DeepAgentsExecuteInput,
    candidate: ParserArtifactCandidate,
  ): Promise<ParserArtifactCandidate> {
    const helperRetrieval = retrieveRelevantParserHelpers(input);
    let nextCandidate = normalizeParserArtifactCandidate(candidate, input);

    if (needsParserArtifactRepair(input, nextCandidate, helperRetrieval)) {
      nextCandidate = await this.repairParserArtifactCandidate(input, nextCandidate, helperRetrieval);
    }

    nextCandidate = normalizeParserArtifactCandidate(nextCandidate, input);
    const complianceViolations = getParserHelperComplianceViolations(
      nextCandidate.script,
      getParserRequestSignals(input),
      helperRetrieval,
    );

    if (complianceViolations.length > 0) {
      throw new ParserHelperComplianceError(
        `Parser draft did not satisfy the built-in helper requirements: ${complianceViolations[0]}`,
        complianceViolations,
      );
    }

    return nextCandidate;
  }

  private async repairParserArtifactCandidate(
    input: DeepAgentsExecuteInput,
    candidate: ParserArtifactCandidate,
    helperRetrieval: ParserHelperRetrieval,
  ): Promise<ParserArtifactCandidate> {
    const requestHints = buildParserRequestHintText(input);
    try {
      const response = await input.modelClient.generate({
        mode: "execute",
        systemPrompt: [
          "You repair MQTT parser draft artifacts.",
          "Return only one tagged block in this exact format:",
          "<artifact_candidate>{...}</artifact_candidate>",
          "Rules:",
          "1. Keep parse(input, helpers) as the public function signature.",
          "2. Prefer helpers.* methods for binary parsing instead of manual shifts, DataView, Buffer, or handwritten endian logic whenever an equivalent helper exists.",
          "3. Use explicit BE/LE helper variants for every multi-byte integer or float field.",
          "4. Use helpers.hexToBytes when bytes need to be derived from input.payloadHex.",
          "5. If the request mentions status bits, flags, alarms, or bitfields, use helpers.bit/bits instead of manual masks when practical.",
          "6. Prefer a partial but specific parser over a generic template. Keep uncertain bytes as raw hex if needed.",
          "7. Keep summary concise in plain text, and keep assumptions/risks/nextSteps to at most 2 short items each.",
          "8. Do not use Markdown headings, bold markers, bullet lists, numbered lists, or code fences in the summary fields.",
          PARSER_HELPER_USAGE_NOTE,
          `Available helper cheat sheet: ${PARSER_HELPER_CHEAT_SHEET}`,
          formatHelperRetrievalForPrompt(helperRetrieval),
        ].join("\n\n"),
        userMessage: [
          `Original request: ${input.userMessage}`,
          `Suggested topic filter: ${input.suggestedTopicFilter ?? "infer from the request"}`,
          requestHints,
          "Original artifact candidate JSON:",
          JSON.stringify(candidate, null, 2),
        ].join("\n\n"),
      });
      const repaired = parseArtifactCandidateTag(response.content);
      return repaired ? normalizeParserArtifactCandidate(repaired, input) : candidate;
    } catch (error) {
      this.logger.warn("parser artifact helper repair failed; keeping original candidate", {
        error: toErrorMessage(error),
      });
      return candidate;
    }
  }

  private extractApprovalInterrupt(
    result: DeepAgentStreamState,
    threadId: string | null,
  ): DeepAgentsApprovalInterrupt | null {
    if (!threadId) {
      return null;
    }

    const interrupts = Array.isArray(result?.__interrupt__) ? result.__interrupt__ : [];
    const interrupt = asRecord(interrupts[0]);
    const value = asRecord(interrupt?.value);
    const actionRequests = Array.isArray(value?.actionRequests) ? value.actionRequests : [];
    const actionRequest = asRecord(actionRequests[0]);
    if (!actionRequest || typeof actionRequest.name !== "string") {
      return null;
    }

    const reviewConfigs = Array.isArray(value?.reviewConfigs) ? value.reviewConfigs : [];
    const reviewConfig =
      reviewConfigs
        .map((item) => asRecord(item))
        .find((item) => item?.actionName === actionRequest.name) ?? null;
    const allowedDecisions = Array.isArray(reviewConfig?.allowedDecisions)
      ? reviewConfig.allowedDecisions.filter(isApprovalDecision)
      : [...PARSER_ARTIFACT_APPROVAL_DECISIONS];
    const description =
      typeof actionRequest.description === "string"
        ? actionRequest.description
        : typeof reviewConfig?.description === "string"
          ? reviewConfig.description
          : null;

    return {
      threadId,
      toolName: actionRequest.name,
      toolArgs: "args" in actionRequest ? actionRequest.args : null,
      description,
      allowedDecisions:
        allowedDecisions.length > 0 ? allowedDecisions : [...PARSER_ARTIFACT_APPROVAL_DECISIONS],
    };
  }

  private buildModel(modelClient: ModelClient) {
    const config = modelClient.getRuntimeConfig();
    if (!config.enabled) {
      throw new ModelClientError("agent_disabled", "Agent model is disabled", false);
    }
    if (!config.apiKey.trim()) {
      throw new ModelClientError("missing_api_key", "OpenAI API key is missing", false);
    }

    return new OpenAIDeepAgentsChatModel({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      protocol: config.protocol,
      temperature: 0,
    });
  }

  private createHumanMessage(message: string, attachments?: AgentAttachmentDto[]) {
    return new HumanMessage({
      content: [
        { type: "text", text: message } satisfies TextContentBlock,
        ...toImageBlocks(attachments),
      ],
    });
  }

  private extractAssistantDelta(message: unknown): string {
    return looksLikeAssistantMessage(message) ? extractMessageContent(message) : "";
  }

  private extractAssistantText(result: unknown): string {
    if (typeof result === "string") {
      return result;
    }

    const record = asRecord(result);
    if (!record) {
      return "";
    }

    if (Array.isArray(record.messages)) {
      for (let index = record.messages.length - 1; index >= 0; index -= 1) {
        const candidate = record.messages[index];
        if (looksLikeAssistantMessage(candidate)) {
          const content = extractMessageContent(candidate);
          if (content) {
            return content;
          }
        }
      }
    }

    if ("content" in record) {
      return normalizeContent(record.content);
    }

    return "";
  }

  private ensureText(content: string): string {
    const text = content.trim();
    if (!text) {
      throw new ModelClientError("empty_response", "OpenAI returned an empty response");
    }

    if (isLikelyHtmlGatewayError(text)) {
      throw new ModelClientError(
        "openai_request_failed",
        "The configured OpenAI-compatible API returned an HTML gateway error page. Check the API base URL or upstream gateway status.",
      );
    }

    return text;
  }
}

function buildParserAuthoringToolPrompt(
  input: Pick<DeepAgentsExecuteInput, "userMessage" | "attachments" | "suggestedTopicFilter">,
  helperRetrieval: ParserHelperRetrieval,
) {
  const signals = getParserRequestSignals(input);
  const topicLine = input.suggestedTopicFilter
    ? `Prefer ${input.suggestedTopicFilter} as the suggested topic filter unless the user request clearly implies a better one.`
    : "Infer the best suggested topic filter from the request.";

  return [
    "You are drafting an MQTT parser authoring artifact.",
    "Always call describe_parser_helpers before capture_parser_artifact so the final draft is grounded in the available helpers.",
    "Prefer list_saved_parsers before drafting when the request looks similar to an existing parser, load_topic_message_samples when you need real payload evidence, and test_parser_script before capture_parser_artifact when you have a viable sample payload.",
    `Before your final answer, you must call ${PARSER_ARTIFACT_TOOL_NAME} exactly once.`,
    "The tool call must include a non-empty JavaScript parse(input, helpers) script and concise review metadata.",
    "The parser script must prefer helpers.* methods for binary parsing. Use helpers.hexToBytes when bytes need to be derived from input.payloadHex, use explicit BE/LE helpers for every multi-byte value, and use helpers.bit/bits for flags instead of manual masks when practical.",
    "Avoid manual byte shifting, DataView, Buffer, or handwritten endian logic when an equivalent helper exists.",
    "Reason about offsets, field widths, endian, scaling, status bits, text encodings, timestamps, and checksum or tail bytes before drafting the parser.",
    "Prefer a partial but specific parser over a generic template. If a field is unclear, preserve that slice as raw hex and mention the uncertainty briefly.",
    "Use semantic field names, not field1/value1 style placeholders, unless the request truly gives no clue.",
    "Keep the final answer short and practical: 1 to 3 short plain-text paragraphs, with 1 to 2 short sentences per paragraph.",
    "Lead with the result in the first paragraph. Start with what you produced, found, or need from the user, not with process narration.",
    "Avoid openings like I inspected, I analyzed, or I looked at unless the user explicitly asked for your process.",
    "Do not use Markdown headings, bold markers, bullet lists, numbered lists, or code fences in the final answer unless the user explicitly asks for them.",
    "Do not use labels such as Summary, Risks, Assumptions, or Next Steps in the final answer.",
    topicLine,
    buildParserRequestHintText(input),
    `Helper reminder: ${PARSER_HELPER_USAGE_NOTE}`,
    `Available helpers: ${PARSER_HELPER_CHEAT_SHEET}`,
    formatHelperRetrievalForPrompt(helperRetrieval),
    signals.mentionsChecksum
      ? "When headers, CRC, or tail bytes are mentioned, preserve uncertain slices with helpers.sliceHex or helpers.bytesToHex instead of leaving opaque manual byte arrays."
      : "",
  ].join(" ");
}

function buildParserAuthoringApprovalDescription(
  suggestedTopicFilter: string | null | undefined,
  request: string,
) {
  const topicLine = suggestedTopicFilter
    ? `Topic filter: ${suggestedTopicFilter}`
    : "Topic filter: infer from the current request";

  return [
    "Review the generated MQTT parser draft before it is committed as an artifact.",
    topicLine,
    `Request summary: ${request.trim().slice(0, 160) || "Parser authoring task"}`,
  ].join("\n");
}

function toImageBlocks(attachments?: AgentAttachmentDto[]) {
  return (attachments ?? [])
    .filter((attachment) => typeof attachment.dataUrl === "string" && attachment.dataUrl.length > 0)
    .map(
      (attachment) =>
        ({
          type: "image_url",
          image_url: {
            url: attachment.dataUrl,
          },
        }) satisfies ImageContentBlock,
    );
}

function looksLikeAssistantMessage(message: unknown) {
  const record = asRecord(message);
  if (!record) {
    return false;
  }

  const role = typeof record.role === "string" ? record.role : undefined;
  const type = typeof record.type === "string" ? record.type : undefined;
  const constructorName =
    typeof record.constructor?.name === "string" ? record.constructor.name : undefined;

  return (
    role === "assistant" ||
    type === "ai" ||
    constructorName === "AIMessage" ||
    constructorName === "AIMessageChunk"
  );
}

function extractMessageContent(message: unknown) {
  const record = asRecord(message);
  return record && "content" in record ? normalizeContent(record.content) : "";
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }

      const record = asRecord(block);
      if (!record || record.type !== "text" || typeof record.text !== "string") {
        return "";
      }

      return record.text;
    })
    .join("");
}

function parseTaggedParserFallback(content: string): {
  assistantText: string;
  artifactCandidate?: ParserArtifactCandidate;
} {
  const assistantMatch = content.match(/<assistant_summary>([\s\S]*?)<\/assistant_summary>/i);
  const artifactMatch = content.match(/<artifact_candidate>([\s\S]*?)<\/artifact_candidate>/i);
  const artifactPayload = artifactMatch?.[1]?.trim();
  const parsedArtifact = artifactPayload ? safeParseJson(artifactPayload) : null;
  const artifactCandidate = parserArtifactCandidateSchema.safeParse(parsedArtifact);

  return {
    assistantText: assistantMatch?.[1]?.trim() ?? content.trim(),
    ...(artifactCandidate.success ? { artifactCandidate: artifactCandidate.data } : {}),
  };
}

function parseArtifactCandidateTag(content: string): ParserArtifactCandidate | null {
  const artifactMatch = content.match(/<artifact_candidate>([\s\S]*?)<\/artifact_candidate>/i);
  const artifactPayload = artifactMatch?.[1]?.trim();
  const parsedArtifact = artifactPayload ? safeParseJson(artifactPayload) : null;
  const artifactCandidate = parserArtifactCandidateSchema.safeParse(parsedArtifact);
  return artifactCandidate.success ? artifactCandidate.data : null;
}

function normalizeParserArtifactCandidate(
  candidate: ParserArtifactCandidate,
  input?: Pick<DeepAgentsExecuteInput, "userMessage" | "suggestedTopicFilter" | "attachments">,
): ParserArtifactCandidate {
  const normalizedScript = normalizeParserScript(candidate.script);
  const signals = getParserRequestSignals(input);
  const summary = normalizeParserSummary(candidate.summary, {
    topicFilter: candidate.suggestedTopicFilter ?? input?.suggestedTopicFilter ?? null,
    request: input?.userMessage ?? "",
    script: normalizedScript,
    signals,
  });
  const assumptions = normalizeParserList(candidate.assumptions, {
    fallback: buildParserAssumptionFallbacks(
      candidate.suggestedTopicFilter ?? input?.suggestedTopicFilter ?? null,
      signals,
    ),
  });
  const risks = normalizeParserList(candidate.risks, {
    fallback: buildParserRiskFallbacks(signals),
  });
  const nextSteps = normalizeParserList(candidate.nextSteps, {
    fallback: buildParserNextStepFallbacks(
      candidate.suggestedTopicFilter ?? input?.suggestedTopicFilter ?? null,
      candidate.suggestedTestPayloadHex,
      signals,
    ),
  });
  const sourceSampleSummary = normalizeSourceSampleSummary(candidate.sourceSampleSummary, {
    request: input?.userMessage ?? "",
    signals,
  });

  return {
    ...candidate,
    name: candidate.name.trim(),
    script: normalizedScript,
    ...(candidate.suggestedTopicFilter
      ? { suggestedTopicFilter: candidate.suggestedTopicFilter.trim() }
      : {}),
    ...(candidate.suggestedTestPayloadHex
      ? { suggestedTestPayloadHex: candidate.suggestedTestPayloadHex.trim() }
      : {}),
    ...(summary ? { summary } : {}),
    ...(assumptions.length > 0 ? { assumptions } : {}),
    ...(risks.length > 0 ? { risks } : {}),
    ...(nextSteps.length > 0 ? { nextSteps } : {}),
    ...(sourceSampleSummary ? { sourceSampleSummary } : {}),
  };
}

function normalizeParserScript(script: string) {
  let nextScript = script.trim();

  nextScript = nextScript.replace(
    /const\s+bytes\s*=\s*input\.bytes\s*(?:\?\?\s*\[\]|\|\|\s*\[\])?\s*;/,
    `${PARSER_BYTES_BOOTSTRAP_LINE}`,
  );

  if (!/helpers\.hexToBytes\s*\(/.test(nextScript)) {
    nextScript = nextScript.replace(
      /(function\s+parse\s*\(\s*input\s*,\s*helpers\s*\)\s*\{\s*)/,
      `$1\n  ${PARSER_BYTES_BOOTSTRAP_LINE}\n`,
    );
  }

  nextScript = nextScript.replace(
    /helpers\.(read(?:Uint|Int|Float)\d+(?:BE|LE)|slice(?:Bytes|Hex)|read(?:Ascii|Utf8|Bcd)|startsWithBytes)\(\s*input\.bytes\s*,/g,
    "helpers.$1(bytes,",
  );

  return nextScript.trim();
}

function hasMeaningfulParserHelperUsage(script: string) {
  return /helpers\.(read(?:Uint|Int|Float)\d+(?:BE|LE)|bit|bits|slice(?:Bytes|Hex)|read(?:Ascii|Utf8|Bcd)|startsWithBytes|unix(?:Seconds|Millis))\s*\(/.test(
    script,
  );
}

function needsParserArtifactRepair(
  input: Pick<DeepAgentsExecuteInput, "userMessage" | "attachments">,
  candidate: ParserArtifactCandidate,
  helperRetrieval: ParserHelperRetrieval,
) {
  if (!hasMeaningfulParserHelperUsage(candidate.script)) {
    return true;
  }

  const signals = getParserRequestSignals(input);
  const script = candidate.script;
  const hasMultiByteHelper = /helpers\.read(?:Uint|Int|Float)(?:16|32|64)(?:BE|LE)\s*\(/.test(script);
  const hasBitHelper = /helpers\.(?:bit|bits)\s*\(/.test(script);

  if (signals.endianHint === "le" && hasMultiByteHelper && !/helpers\.read(?:Uint|Int|Float)\d+LE\s*\(/.test(script)) {
    return true;
  }

  if (signals.endianHint === "be" && hasMultiByteHelper && !/helpers\.read(?:Uint|Int|Float)\d+BE\s*\(/.test(script)) {
    return true;
  }

  if (signals.mentionsBitFields && !hasBitHelper) {
    return true;
  }

  return getParserHelperComplianceViolations(candidate.script, signals, helperRetrieval).length > 0;
}

function getParserRequestSignals(
  input?: Pick<DeepAgentsExecuteInput, "userMessage" | "attachments">,
): ParserRequestSignals {
  const request = input?.userMessage?.toLowerCase() ?? "";
  const attachments = input?.attachments ?? [];
  const hasLittleEndian =
    /\blittle[- ]endian\b|\ble\b|小端|低字节在前|低位在前/.test(request) &&
    !/\bbig[- ]endian\b|大端|高字节在前|高位在前/.test(request);
  const hasBigEndian =
    /\bbig[- ]endian\b|\bbe\b|大端|高字节在前|高位在前/.test(request) &&
    !/\blittle[- ]endian\b|小端|低字节在前|低位在前/.test(request);

  return {
    endianHint: hasLittleEndian ? "le" : hasBigEndian ? "be" : null,
    mentionsBitFields: /bit|bits|flag|flags|status bit|status bits|位|bitfield|alarm/.test(request),
    mentionsText: /ascii|utf-?8|text|字符串|文本|字符/.test(request),
    mentionsBcd: /\bbcd\b/.test(request),
    mentionsTimestamp: /timestamp|time|时间戳|秒|毫秒|unix/.test(request),
    mentionsFloat: /float|double|浮点/.test(request),
    mentionsChecksum: /crc|checksum|校验|tail|footer|magic|header/.test(request),
    attachmentCount: attachments.length,
  };
}

function buildParserRequestHintText(
  input: Pick<DeepAgentsExecuteInput, "userMessage" | "attachments">,
) {
  const signals = getParserRequestSignals(input);
  const hints: string[] = [];

  if (signals.endianHint === "le") {
    hints.push("Multi-byte fields likely use little-endian (LE).");
  } else if (signals.endianHint === "be") {
    hints.push("Multi-byte fields likely use big-endian (BE).");
  }

  if (signals.mentionsBitFields) {
    hints.push("The request mentions status bits or flags, so the parser should expose them with helpers.bit/helpers.bits.");
  }

  if (signals.mentionsText) {
    hints.push("The request mentions text decoding, so prefer helpers.readAscii/helpers.readUtf8 where applicable.");
  }

  if (signals.mentionsBcd) {
    hints.push("The request mentions BCD fields, so prefer helpers.readBcd.");
  }

  if (signals.mentionsTimestamp) {
    hints.push("The request mentions timestamps, so prefer helpers.unixSeconds/helpers.unixMillis when raw values match.");
  }

  if (signals.mentionsFloat) {
    hints.push("The request mentions floating-point values, so prefer explicit BE/LE float helpers.");
  }

  if (signals.mentionsChecksum) {
    hints.push("The request mentions headers, tail bytes, or checksum markers, so preserve unmatched bytes as raw hex when they are not fully specified.");
  }

  if (signals.attachmentCount > 0) {
    hints.push(
      `The request includes ${signals.attachmentCount} image attachment(s); use them as protocol evidence for offsets, byte order, and bit layout.`,
    );
  }

  return hints.length > 0 ? ["Request hints:", ...hints].join("\n") : "Request hints: none";
}

function retrieveRelevantParserHelpers(
  input?: Pick<DeepAgentsExecuteInput, "userMessage" | "attachments">,
): ParserHelperRetrieval {
  const signals = getParserRequestSignals(input);
  const helperNames = new Set<string>(["hexToBytes", "readUint8"]);
  const helperUsageRules = [
    "Use helpers.hexToBytes to derive bytes from input.payloadHex before parsing multi-byte or textual fields.",
    "Do not use DataView, Buffer, or handwritten endian logic when an equivalent helpers.* method exists.",
  ];
  const helperReminders: string[] = [];

  if (signals.endianHint === "le") {
    [
      "readUint16LE",
      "readInt16LE",
      "readUint32LE",
      "readInt32LE",
      "readUint64LE",
      "readInt64LE",
      "readFloat32LE",
      "readFloat64LE",
    ].forEach((name) => helperNames.add(name));
    helperUsageRules.push(
      "The request indicates little-endian fields, so every multi-byte numeric value must use the matching LE helper.",
    );
    helperReminders.push("Use explicit LE helpers for multi-byte values.");
  } else if (signals.endianHint === "be") {
    [
      "readUint16BE",
      "readInt16BE",
      "readUint32BE",
      "readInt32BE",
      "readUint64BE",
      "readInt64BE",
      "readFloat32BE",
      "readFloat64BE",
    ].forEach((name) => helperNames.add(name));
    helperUsageRules.push(
      "The request indicates big-endian fields, so every multi-byte numeric value must use the matching BE helper.",
    );
    helperReminders.push("Use explicit BE helpers for multi-byte values.");
  }

  if (signals.mentionsBitFields) {
    ["bit", "bits"].forEach((name) => helperNames.add(name));
    helperUsageRules.push(
      "The request mentions status bits or flags, so expose them with helpers.bit/helpers.bits instead of raw masks.",
    );
    helperReminders.push("Flags should be decoded with helpers.bit/helpers.bits.");
  }

  if (signals.mentionsText) {
    ["readAscii", "readUtf8"].forEach((name) => helperNames.add(name));
    helperUsageRules.push(
      "The request mentions text fields, so decode them with helpers.readAscii or helpers.readUtf8 instead of manual char conversion.",
    );
  }

  if (signals.mentionsBcd) {
    helperNames.add("readBcd");
    helperUsageRules.push("BCD fields should use helpers.readBcd.");
  }

  if (signals.mentionsTimestamp) {
    ["unixSeconds", "unixMillis"].forEach((name) => helperNames.add(name));
    helperUsageRules.push(
      "Timestamp fields should use helpers.unixSeconds or helpers.unixMillis once the raw integer value is decoded.",
    );
  }

  if (signals.mentionsChecksum) {
    ["sliceHex", "bytesToHex", "startsWithBytes"].forEach((name) => helperNames.add(name));
    helperUsageRules.push(
      "Headers, CRC bytes, and uncertain tail bytes should be preserved with helpers.sliceHex/helpers.bytesToHex when they are not fully decoded.",
    );
  }

  if (signals.mentionsFloat && signals.endianHint == null) {
    ["readFloat32BE", "readFloat32LE", "readFloat64BE", "readFloat64LE"].forEach((name) =>
      helperNames.add(name),
    );
    helperUsageRules.push("Floating-point fields must use explicit BE/LE float helpers.");
  }

  const relevantHelpers = listParserHelpers([...helperNames]);
  return {
    relevantHelpers,
    helperUsageRules: Array.from(new Set(helperUsageRules)),
    helperReminders: Array.from(new Set(helperReminders)),
  };
}

function formatHelperRetrievalForPrompt(retrieval: ParserHelperRetrieval) {
  const helperLines = retrieval.relevantHelpers.map(
    (helper) => `${helper.signature}: ${helper.description}`,
  );
  const ruleLines = retrieval.helperUsageRules.map((rule) => `- ${rule}`);
  const reminderLines = retrieval.helperReminders.map((reminder) => `- ${reminder}`);

  return [
    "Retrieved helper context:",
    helperLines.length > 0 ? helperLines.join(" | ") : "No helper-specific retrieval matched.",
    "Helper usage rules:",
    ruleLines.length > 0 ? ruleLines.join("\n") : "- Use helpers.* whenever an equivalent helper exists.",
    reminderLines.length > 0 ? ["Helper reminders:", ...reminderLines].join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getParserHelperComplianceViolations(
  script: string,
  signals: ParserRequestSignals,
  retrieval: ParserHelperRetrieval,
) {
  const violations: string[] = [];

  if (!/function\s+parse\s*\(\s*input\s*,\s*helpers\s*\)/.test(script)) {
    violations.push("Use the public parse(input, helpers) function signature.");
  }

  if (!/helpers\.hexToBytes\s*\(\s*input\.payloadHex\s*\)/.test(script)) {
    violations.push("Initialize bytes with helpers.hexToBytes(input.payloadHex) when normalizing input bytes.");
  }

  if (/\b(?:new\s+DataView|DataView\s*\(|Buffer(?:\.from)?\s*\()/i.test(script)) {
    violations.push("Do not use DataView or Buffer when an equivalent helpers.* method exists.");
  }

  if (hasManualByteAssembly(script)) {
    violations.push("Replace handwritten multi-byte byte shifting with explicit helpers.read*BE/LE methods.");
  }

  if (signals.endianHint === "le" && !/helpers\.read(?:Uint|Int|Float)\d+LE\s*\(/.test(script)) {
    violations.push("Use explicit LE helpers for the multi-byte fields described as little-endian.");
  }

  if (signals.endianHint === "be" && !/helpers\.read(?:Uint|Int|Float)\d+BE\s*\(/.test(script)) {
    violations.push("Use explicit BE helpers for the multi-byte fields described as big-endian.");
  }

  if (signals.mentionsBitFields && !/helpers\.(?:bit|bits)\s*\(/.test(script)) {
    violations.push("Use helpers.bit/helpers.bits for status flags and bitfields.");
  }

  if (signals.mentionsText && !/helpers\.read(?:Ascii|Utf8)\s*\(/.test(script)) {
    violations.push("Use helpers.readAscii or helpers.readUtf8 for textual fields.");
  }

  if (signals.mentionsBcd && !/helpers\.readBcd\s*\(/.test(script)) {
    violations.push("Use helpers.readBcd for packed BCD fields.");
  }

  if (signals.mentionsTimestamp && !/helpers\.unix(?:Seconds|Millis)\s*\(/.test(script)) {
    violations.push("Format timestamps with helpers.unixSeconds or helpers.unixMillis.");
  }

  if (
    signals.mentionsChecksum &&
    !/helpers\.(?:sliceHex|bytesToHex|startsWithBytes)\s*\(/.test(script)
  ) {
    violations.push("Use helpers.sliceHex/helpers.bytesToHex/helpers.startsWithBytes for header, CRC, or tail preservation.");
  }

  if (signals.mentionsFloat && !/helpers\.readFloat(?:32|64)(?:BE|LE)\s*\(/.test(script)) {
    violations.push("Use explicit helpers.readFloat32*/readFloat64* helpers for floating-point fields.");
  }

  const requiredNames = new Set(retrieval.relevantHelpers.map((helper) => helper.name));
  if (
    requiredNames.has("bit") &&
    requiredNames.has("bits") &&
    signals.mentionsBitFields &&
    !/helpers\.(?:bit|bits)\s*\(/.test(script)
  ) {
    violations.push("The retrieved helper context requires helpers.bit/helpers.bits for this request.");
  }

  return Array.from(new Set(violations));
}

function hasManualByteAssembly(script: string) {
  return (
    /bytes\s*\[\s*\d+\s*\]\s*(?:<<|>>>?)\s*\d+/.test(script) ||
    /\(\s*bytes\s*\[\s*\d+\s*\]\s*(?:<<|>>>?)\s*\d+\s*\)\s*\|/.test(script) ||
    /\|\s*\(\s*bytes\s*\[\s*\d+\s*\]\s*(?:<<|>>>?)\s*\d+\s*\)/.test(script)
  );
}

function normalizeParserSummary(
  summary: string | undefined,
  input: {
    topicFilter: string | null;
    request: string;
    script: string;
    signals: ParserRequestSignals;
  },
) {
  const trimmed = summary?.trim() ?? "";
  const candidate = trimmed ? condenseParserAssistantText(trimmed) : "";
  if (candidate && !isGenericParserText(candidate)) {
    return candidate;
  }

  const behaviors = describeParserScript(input.script, input.signals);
  const topic = input.topicFilter?.trim() || inferTopicFromRequest(input.request) || "the target topic";
  const clauses =
    behaviors.length > 0
      ? pickSummaryBehaviors(behaviors).join(" and ")
      : "extracts structured fields from the payload";
  return clampText(`Parser draft for ${topic} that ${clauses}.`, PARSER_CONCISE_REPLY_MAX_CHARS);
}

function describeParserScript(script: string, signals: ParserRequestSignals) {
  const behaviors: string[] = [];

  if (/helpers\.startsWithBytes\s*\(/.test(script)) {
    behaviors.push("validates frame headers");
  }

  if (/helpers\.read(?:Uint|Int)(?:16|32|64)LE\s*\(/.test(script)) {
    behaviors.push("reads little-endian numeric fields");
  } else if (/helpers\.read(?:Uint|Int)(?:16|32|64)BE\s*\(/.test(script)) {
    behaviors.push("reads big-endian numeric fields");
  }

  if (/helpers\.readFloat(?:32|64)LE\s*\(/.test(script)) {
    behaviors.push("decodes little-endian floating-point values");
  } else if (/helpers\.readFloat(?:32|64)BE\s*\(/.test(script)) {
    behaviors.push("decodes big-endian floating-point values");
  }

  if (/helpers\.(?:bit|bits)\s*\(/.test(script) || signals.mentionsBitFields) {
    behaviors.push("extracts status bits");
  }

  if (/helpers\.readAscii\s*\(/.test(script)) {
    behaviors.push("decodes ASCII text");
  } else if (/helpers\.readUtf8\s*\(/.test(script)) {
    behaviors.push("decodes UTF-8 text");
  } else if (signals.mentionsText) {
    behaviors.push("keeps text fields explicit");
  }

  if (/helpers\.readBcd\s*\(/.test(script) || signals.mentionsBcd) {
    behaviors.push("decodes BCD digits");
  }

  if (/helpers\.unix(?:Seconds|Millis)\s*\(/.test(script) || signals.mentionsTimestamp) {
    behaviors.push("formats timestamps");
  }

  if (/helpers\.(?:sliceHex|bytesToHex)\s*\(/.test(script) || signals.mentionsChecksum) {
    behaviors.push("keeps unmatched bytes as hex for review");
  }

  return Array.from(new Set(behaviors));
}

function pickSummaryBehaviors(behaviors: string[]) {
  const priority = [
    "validates frame headers",
    "decodes ASCII text",
    "decodes UTF-8 text",
    "decodes BCD digits",
    "formats timestamps",
    "extracts status bits",
    "reads little-endian numeric fields",
    "reads big-endian numeric fields",
    "decodes little-endian floating-point values",
    "decodes big-endian floating-point values",
    "keeps unmatched bytes as hex for review",
    "keeps text fields explicit",
  ];

  const selected: string[] = [];
  for (const item of priority) {
    if (behaviors.includes(item)) {
      selected.push(item);
    }
    if (selected.length >= 3) {
      return selected;
    }
  }

  for (const item of behaviors) {
    if (!selected.includes(item)) {
      selected.push(item);
    }
    if (selected.length >= 3) {
      break;
    }
  }

  return selected;
}

function normalizeParserList(
  values: string[] | undefined,
  input: {
    fallback: string[];
  },
) {
  const normalized = (values ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index)
    .filter((item) => !isGenericParserText(item))
    .slice(0, 2);

  return normalized.length > 0 ? normalized : input.fallback.slice(0, 2);
}

function buildParserAssumptionFallbacks(topicFilter: string | null, signals: ParserRequestSignals) {
  const assumptions: string[] = [];

  if (signals.endianHint === "le") {
    assumptions.push("Multi-byte fields are interpreted as little-endian (LE) based on the request.");
  } else if (signals.endianHint === "be") {
    assumptions.push("Multi-byte fields are interpreted as big-endian (BE) based on the request.");
  }

  if (signals.mentionsBitFields) {
    assumptions.push("Flag bits are numbered from the least-significant bit unless the protocol says otherwise.");
  }

  if (signals.attachmentCount > 0) {
    assumptions.push("Byte offsets are inferred from the attached protocol image and still need a live payload check.");
  }

  assumptions.push(
    topicFilter ? `The payload layout for ${topicFilter} is stable enough for a reusable parser draft.` : "The payload layout is stable enough for a reusable parser draft.",
  );

  return assumptions;
}

function buildParserRiskFallbacks(signals: ParserRequestSignals) {
  const risks: string[] = [];

  if (signals.mentionsBitFields) {
    risks.push("Confirm bit numbering and reserved flag handling against a real sample before saving the parser.");
  }

  if (signals.endianHint) {
    risks.push(`Validate the ${signals.endianHint.toUpperCase()} endian assumption with a known-good live payload to avoid swapped values.`);
  }

  if (signals.attachmentCount > 0) {
    risks.push("The attached protocol image may omit optional bytes or firmware variations.");
  }

  risks.push("Field semantics and scaling still need one live payload verification run.");
  return risks;
}

function buildParserNextStepFallbacks(
  topicFilter: string | null,
  suggestedTestPayloadHex: string | undefined,
  signals: ParserRequestSignals,
) {
  const nextSteps: string[] = [];

  if (suggestedTestPayloadHex?.trim()) {
    nextSteps.push(`Test the draft with ${suggestedTestPayloadHex.trim()} in Parser Library.`);
  }

  nextSteps.push(
    topicFilter
      ? `Compare the decoded fields against one live payload from ${topicFilter}.`
      : "Compare the decoded fields against one live payload from the target topic.",
  );

  if (signals.mentionsBitFields) {
    nextSteps.push("Verify each exposed status bit against the device documentation or a known device state.");
  } else if (signals.attachmentCount > 0) {
    nextSteps.push("Check that the attached protocol image matches the actual byte offsets seen in live payloads.");
  }

  return nextSteps;
}

function normalizeSourceSampleSummary(
  sourceSampleSummary: string | undefined,
  input: {
    request: string;
    signals: ParserRequestSignals;
  },
) {
  const trimmed = sourceSampleSummary?.trim() ?? "";
  if (trimmed && !isGenericParserText(trimmed)) {
    return clampText(trimmed, 180);
  }

  if (input.signals.attachmentCount > 0) {
    return clampText(
      `Inferred from the request and ${input.signals.attachmentCount} attached protocol image(s).`,
      180,
    );
  }

  const requestSummary = input.request.trim().replace(/\s+/g, " ");
  return requestSummary ? clampText(requestSummary, 180) : undefined;
}

function inferTopicFromRequest(request: string) {
  return (
    request.match(/(?:topic|主题)\s*[:：]\s*([A-Za-z0-9/_#+-]+)/i)?.[1] ??
    request.match(/\b([A-Za-z0-9_-]+\/[A-Za-z0-9/_#+-]+)\b/)?.[1] ??
    ""
  );
}

function isGenericParserText(value: string) {
  return PARSER_GENERIC_TEXT_PATTERN.test(value.trim());
}

function condenseParserAssistantText(text: string) {
  const trimmed = normalizeAssistantPlainText(text);
  if (!trimmed) {
    return trimmed;
  }

  const normalized = trimmed.replace(/\s+/g, " ");
  const sentences =
    normalized
      .match(/[^.!?。！？\n]+[.!?。！？]?/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? [normalized];
  return clampText(
    sentences
      .slice(0, PARSER_CONCISE_REPLY_MAX_SENTENCES)
      .join("\n\n")
      .trim(),
    PARSER_CONCISE_REPLY_MAX_CHARS,
  );
}

function clampText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeAssistantPlainText(value: string) {
  const withoutCodeFences = value.replace(/```[\w-]*\r?\n?/g, "").replace(/```/g, "");
  const lines = withoutCodeFences
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/g, "")
        .replace(/^\*\*(.+?)\*\*$/g, "$1")
        .replace(/^__(.+?)__$/g, "$1")
        .replace(/^[-*+]\s+/g, "")
        .replace(/^\d+\.\s+/g, "")
        .replace(/^(summary|risks?|assumptions?|next steps?)\s*:\s*/i, "")
        .replace(/^(summary|risks?|assumptions?|next steps?)$/i, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1"),
    );

  return lines.join(" ").replace(/\s+/g, " ").trim();
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isLikelyHtmlGatewayError(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    (normalized.startsWith("<!doctype html") || normalized.startsWith("<html")) &&
    (normalized.includes("bad gateway") ||
      normalized.includes("error code 502") ||
      normalized.includes("cloudflare"))
  );
}

function asRecord(value: unknown): Record<string, any> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, any>) : null;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isApprovalDecision(
  value: unknown,
): value is (typeof PARSER_ARTIFACT_APPROVAL_DECISIONS)[number] | "edit" {
  return value === "approve" || value === "reject" || value === "edit";
}
