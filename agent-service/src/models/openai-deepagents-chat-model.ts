import OpenAI from "openai";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type {
  BaseChatModelCallOptions,
  BaseChatModelParams,
  BindToolsInput,
  ToolChoice,
} from "@langchain/core/language_models/chat_models";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import {
  convertMessagesToResponsesInput,
  convertResponsesDeltaToChatGenerationChunk,
} from "@langchain/openai";
import { ModelClientError } from "./types.js";

export interface OpenAIDeepAgentsChatModelFields extends BaseChatModelParams {
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
}

export interface OpenAIDeepAgentsChatCallOptions extends BaseChatModelCallOptions {
  tools?: unknown[];
  tool_choice?: ToolChoice | Record<string, unknown>;
  parallel_tool_calls?: boolean;
}

export class OpenAIDeepAgentsChatModel extends BaseChatModel<OpenAIDeepAgentsChatCallOptions> {
  private readonly apiKey: string;
  private readonly baseUrl?: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly client: OpenAI;
  private defaultOptions: Partial<OpenAIDeepAgentsChatCallOptions> = {};

  constructor(fields: OpenAIDeepAgentsChatModelFields) {
    super(fields);
    this.apiKey = fields.apiKey;
    this.baseUrl = fields.baseUrl?.trim() || undefined;
    this.model = fields.model;
    this.temperature = fields.temperature ?? 0;
    this.client = new OpenAI({
      apiKey: this.apiKey,
      ...(this.baseUrl ? { baseURL: this.baseUrl } : {}),
    });
  }

  bindTools(tools: BindToolsInput[], kwargs?: Partial<OpenAIDeepAgentsChatCallOptions>) {
    const bound = new OpenAIDeepAgentsChatModel({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      model: this.model,
      temperature: this.temperature,
      disableStreaming: this.disableStreaming,
      outputVersion: this.outputVersion,
    });
    bound.defaultOptions = {
      ...this.defaultOptions,
      ...kwargs,
      tools: tools.map((tool) => formatToolDefinition(tool)),
    };
    return bound;
  }

  override invocationParams(options?: this["ParsedCallOptions"]) {
    const merged = this.mergeCallOptions(options);
    return {
      model: this.model,
      temperature: this.temperature,
      tool_choice: formatToolChoice(merged.tool_choice),
      tools: merged.tools,
      parallel_tool_calls: merged.parallel_tool_calls,
    };
  }

  override getLsParams(options: this["ParsedCallOptions"]) {
    return {
      ls_provider: "openai",
      ls_model_name: this.model,
      ls_model_type: "chat" as const,
      ls_temperature: this.temperature,
      ls_stop: options.stop,
    };
  }

  _llmType() {
    return "openai_sdk_responses";
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
  ): Promise<ChatResult> {
    const merged = this.mergeCallOptions(options);

    try {
      const response = await this.client.responses.create(this.buildRequest(messages, merged));
      const aiMessage = toAiMessage(response);
      const text = extractMessageText(aiMessage);
      if (isLikelyHtmlGatewayError(text)) {
        throw createHtmlGatewayError();
      }

      return {
        generations: [
          {
            text,
            message: aiMessage,
            generationInfo: aiMessage.response_metadata,
          },
        ],
        ...(response.usage
          ? {
              llmOutput: {
                tokenUsage: {
                  promptTokens: response.usage.input_tokens ?? 0,
                  completionTokens: response.usage.output_tokens ?? 0,
                  totalTokens: response.usage.total_tokens ?? 0,
                },
              },
            }
          : {}),
      };
    } catch (error) {
      throw toModelClientError(error);
    }
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const merged = this.mergeCallOptions(options);

    try {
      const stream = this.client.responses.stream(this.buildStreamingRequest(messages, merged));
      for await (const event of stream) {
        const chunk = convertResponsesDeltaToChatGenerationChunk(event);
        if (!chunk) {
          continue;
        }

        if (chunk.text) {
          await runManager?.handleLLMNewToken(chunk.text);
          if (isLikelyHtmlGatewayError(chunk.text)) {
            throw createHtmlGatewayError();
          }
        }

        yield chunk;
      }

      const finalResponse = await stream.finalResponse();
      if (isLikelyHtmlGatewayError(finalResponse.output_text ?? "")) {
        throw createHtmlGatewayError();
      }
    } catch (error) {
      throw toModelClientError(error);
    }
  }

  private mergeCallOptions(options?: this["ParsedCallOptions"]) {
    return {
      ...this.defaultOptions,
      ...(options ?? {}),
    };
  }

  private buildRequest(messages: BaseMessage[], options: Partial<OpenAIDeepAgentsChatCallOptions>) {
    const request: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model: this.model,
      temperature: this.temperature,
      input: convertMessagesToResponsesInput({
        messages,
        zdrEnabled: false,
        model: this.model,
      }),
    };

    const tools = Array.isArray(options.tools) ? options.tools.filter(Boolean) : [];
    if (tools.length > 0) {
      request.tools = tools as OpenAI.Responses.Tool[];
    }

    const toolChoice = formatToolChoice(options.tool_choice);
    if (toolChoice !== undefined) {
      request.tool_choice = toolChoice as OpenAI.Responses.ToolChoiceOptions;
    }

    if (typeof options.parallel_tool_calls === "boolean") {
      request.parallel_tool_calls = options.parallel_tool_calls;
    }

    return request;
  }

  private buildStreamingRequest(
    messages: BaseMessage[],
    options: Partial<OpenAIDeepAgentsChatCallOptions>,
  ) {
    return {
      ...this.buildRequest(messages, options),
      stream: true as const,
    };
  }
}

function formatToolDefinition(tool: BindToolsInput) {
  if (hasProviderToolDefinition(tool)) {
    return tool.extras.providerToolDefinition;
  }

  if (isBuiltInTool(tool) || isOpenAICustomTool(tool)) {
    return tool;
  }

  return convertToOpenAITool(tool);
}

function toAiMessage(response: OpenAI.Responses.Response) {
  const toolCalls = response.output
    .filter((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call")
    .map((item) => ({
      id: item.call_id,
      name: item.name,
      args: parseToolArgs(item.arguments),
      type: "tool_call" as const,
    }));

  return new AIMessage({
    content: response.output_text ?? "",
    tool_calls: toolCalls,
    response_metadata: {
      id: response.id,
      status: response.status,
      model: response.model,
    },
    ...(response.usage
      ? {
          usage_metadata: {
            input_tokens: response.usage.input_tokens ?? 0,
            output_tokens: response.usage.output_tokens ?? 0,
            total_tokens: response.usage.total_tokens ?? 0,
          },
        }
      : {}),
  });
}

function formatToolChoice(toolChoice: unknown) {
  if (!toolChoice) {
    return undefined;
  }
  if (toolChoice === "any" || toolChoice === "required") {
    return "required";
  }
  if (toolChoice === "auto" || toolChoice === "none") {
    return toolChoice;
  }
  if (typeof toolChoice === "string") {
    return {
      type: "function",
      function: { name: toolChoice },
    };
  }
  return toolChoice;
}

function isBuiltInTool(tool: unknown): tool is Record<string, unknown> {
  return typeof tool === "object" && tool !== null && "type" in tool && tool.type !== "function";
}

function hasProviderToolDefinition(
  tool: unknown,
): tool is { extras: { providerToolDefinition: Record<string, unknown> } } {
  return (
    typeof tool === "object" &&
    tool !== null &&
    "extras" in tool &&
    typeof tool.extras === "object" &&
    tool.extras !== null &&
    "providerToolDefinition" in tool.extras &&
    typeof tool.extras.providerToolDefinition === "object" &&
    tool.extras.providerToolDefinition !== null
  );
}

function isOpenAICustomTool(tool: unknown): tool is Record<string, unknown> {
  return (
    typeof tool === "object" &&
    tool !== null &&
    "type" in tool &&
    tool.type === "custom" &&
    "custom" in tool
  );
}

function extractMessageText(message: { content: unknown }) {
  if (typeof message.content === "string") {
    return message.content;
  }

  if (!Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }
      if (!block || typeof block !== "object") {
        return "";
      }
      if ("text" in block && typeof block.text === "string") {
        return block.text;
      }
      return "";
    })
    .join("");
}

function parseToolArgs(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function createHtmlGatewayError() {
  return new ModelClientError(
    "openai_request_failed",
    "The configured OpenAI-compatible API returned an HTML gateway error page. Check the API base URL or upstream gateway status.",
  );
}

function toModelClientError(error: unknown) {
  if (error instanceof ModelClientError) {
    return error;
  }

  const rawMessage = extractErrorMessage(error);
  if (isLikelyHtmlGatewayError(rawMessage)) {
    return createHtmlGatewayError();
  }

  return new ModelClientError("openai_request_failed", rawMessage || "OpenAI request failed");
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") {
      return record.message;
    }
    if (typeof record.error === "string") {
      return record.error;
    }
  }

  return "OpenAI request failed";
}

function isLikelyHtmlGatewayError(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    (normalized.startsWith("<!doctype html") || normalized.startsWith("<html") || normalized.includes("<html")) &&
    (normalized.includes("bad gateway") ||
      normalized.includes("error code 502") ||
      normalized.includes("cloudflare"))
  );
}
