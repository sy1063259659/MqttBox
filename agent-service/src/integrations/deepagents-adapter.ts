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
import { listParserHelpers, PARSER_HELPER_USAGE_NOTE } from "../tools/parser-helpers.js";

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
  "readFloat32BE",
  "readFloat32LE",
  "bit",
  "bits",
  "sliceHex",
  "readAscii",
  "readUtf8",
  "readBcd",
  "unixSeconds",
  "unixMillis",
])
  .map((helper) => `${helper.signature}: ${helper.description}`)
  .join(" | ");

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
    return {
      mode: "execute",
      systemPrompt: [
        input.systemPrompt,
        "Return a concise human-readable summary first, then append an artifact candidate JSON block.",
        "Use this exact format:",
        "<assistant_summary>...</assistant_summary>",
        "<artifact_candidate>{...}</artifact_candidate>",
        "The artifact_candidate JSON must contain: name, script, suggestedTopicFilter, suggestedTestPayloadHex?, summary?, assumptions?, risks?, nextSteps?, sourceSampleSummary?.",
        "Keep <assistant_summary> to at most 2 short paragraphs or 4 short bullets.",
        "The script must use helpers.* for binary parsing. Prefer helpers.hexToBytes, helpers.read*BE/LE, helpers.bit/bits, helpers.readAscii/readUtf8/readBcd, and helpers.unixSeconds/unixMillis instead of manual byte math when applicable.",
        `Helper reference: ${PARSER_HELPER_USAGE_NOTE}`,
        PARSER_HELPER_CHEAT_SHEET,
      ].join("\n\n"),
      userMessage: [
        input.userMessage,
        `Suggested topic filter: ${input.suggestedTopicFilter ?? "unknown"}`,
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
      systemPrompt: [input.systemPrompt, buildParserAuthoringToolPrompt(input.suggestedTopicFilter)]
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
    let nextCandidate = normalizeParserArtifactCandidate(candidate);

    if (!hasMeaningfulParserHelperUsage(nextCandidate.script)) {
      nextCandidate = await this.repairParserArtifactCandidate(input, nextCandidate);
    }

    return normalizeParserArtifactCandidate(nextCandidate);
  }

  private async repairParserArtifactCandidate(
    input: DeepAgentsExecuteInput,
    candidate: ParserArtifactCandidate,
  ): Promise<ParserArtifactCandidate> {
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
          "5. Keep summary concise, and keep assumptions/risks/nextSteps to at most 2 short items each.",
          PARSER_HELPER_USAGE_NOTE,
          `Available helper cheat sheet: ${PARSER_HELPER_CHEAT_SHEET}`,
        ].join("\n\n"),
        userMessage: [
          `Original request: ${input.userMessage}`,
          `Suggested topic filter: ${input.suggestedTopicFilter ?? "infer from the request"}`,
          "Original artifact candidate JSON:",
          JSON.stringify(candidate, null, 2),
        ].join("\n\n"),
      });
      const repaired = parseArtifactCandidateTag(response.content);
      return repaired ? normalizeParserArtifactCandidate(repaired) : candidate;
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

function buildParserAuthoringToolPrompt(suggestedTopicFilter?: string | null) {
  const topicLine = suggestedTopicFilter
    ? `Prefer ${suggestedTopicFilter} as the suggested topic filter unless the user request clearly implies a better one.`
    : "Infer the best suggested topic filter from the request.";

  return [
    "You are drafting an MQTT parser authoring artifact.",
    "Always call describe_parser_helpers before capture_parser_artifact so the final draft is grounded in the available helpers.",
    `Before your final answer, you must call ${PARSER_ARTIFACT_TOOL_NAME} exactly once.`,
    "The tool call must include a non-empty JavaScript parse(input, helpers) script and concise review metadata.",
    "The parser script must prefer helpers.* methods for binary parsing. Use helpers.hexToBytes when bytes need to be derived from input.payloadHex, use explicit BE/LE helpers for every multi-byte value, and use helpers.bit/bits for flags instead of manual masks when practical.",
    "Avoid manual byte shifting, DataView, Buffer, or handwritten endian logic when an equivalent helper exists.",
    "Keep the final answer short and practical: no more than 2 short paragraphs or 4 short bullets. Explain what the parser extracts, the main assumptions, the main risks, and the next test steps.",
    topicLine,
    `Helper reminder: ${PARSER_HELPER_USAGE_NOTE}`,
    `Available helpers: ${PARSER_HELPER_CHEAT_SHEET}`,
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

function normalizeParserArtifactCandidate(candidate: ParserArtifactCandidate): ParserArtifactCandidate {
  const normalizedScript = normalizeParserScript(candidate.script);
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
    ...(candidate.summary ? { summary: condenseParserAssistantText(candidate.summary) } : {}),
    ...(candidate.assumptions
      ? {
          assumptions: candidate.assumptions.map((item) => item.trim()).filter(Boolean).slice(0, 2),
        }
      : {}),
    ...(candidate.risks
      ? { risks: candidate.risks.map((item) => item.trim()).filter(Boolean).slice(0, 2) }
      : {}),
    ...(candidate.nextSteps
      ? {
          nextSteps: candidate.nextSteps.map((item) => item.trim()).filter(Boolean).slice(0, 2),
        }
      : {}),
    ...(candidate.sourceSampleSummary
      ? { sourceSampleSummary: clampText(candidate.sourceSampleSummary.trim(), 180) }
      : {}),
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

function condenseParserAssistantText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletLines = lines.filter((line) => /^([-*]|\d+\.)\s/.test(line));
  if (bulletLines.length >= 2) {
    return clampText(bulletLines.slice(0, PARSER_CONCISE_REPLY_MAX_LINES).join("\n"), PARSER_CONCISE_REPLY_MAX_CHARS);
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
      .join(" ")
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
