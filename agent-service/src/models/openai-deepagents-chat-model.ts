import OpenAI from "openai";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type {
  BaseChatModelCallOptions,
  BaseChatModelParams,
  BindToolsInput,
  ToolChoice,
} from "@langchain/core/language_models/chat_models";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import {
  convertMessagesToResponsesInput,
  convertResponsesDeltaToChatGenerationChunk,
} from "@langchain/openai";
import { ModelClientError, type ModelProtocol } from "./types.js";

export interface OpenAIDeepAgentsChatModelFields extends BaseChatModelParams {
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  protocol?: ModelProtocol;
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
  private readonly protocol: ModelProtocol;
  private readonly client: OpenAI;
  private defaultOptions: Partial<OpenAIDeepAgentsChatCallOptions> = {};

  constructor(fields: OpenAIDeepAgentsChatModelFields) {
    super(fields);
    this.apiKey = fields.apiKey;
    this.baseUrl = fields.baseUrl?.trim() || undefined;
    this.model = fields.model;
    this.temperature = fields.temperature ?? 0;
    this.protocol = fields.protocol ?? "responses";
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
      protocol: this.protocol,
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
      protocol: this.protocol,
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
    return this.protocol === "chat_completions"
      ? "openai_sdk_chat_completions"
      : "openai_sdk_responses";
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
  ): Promise<ChatResult> {
    const merged = this.mergeCallOptions(options);

    try {
      const aiMessage =
        this.protocol === "chat_completions"
          ? await this.generateChatCompletionMessage(messages, merged)
          : await this.generateResponsesMessage(messages, merged);
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
        ...((aiMessage.usage_metadata
          ? {
              llmOutput: {
                tokenUsage: {
                  promptTokens: aiMessage.usage_metadata.input_tokens ?? 0,
                  completionTokens: aiMessage.usage_metadata.output_tokens ?? 0,
                  totalTokens: aiMessage.usage_metadata.total_tokens ?? 0,
                },
              },
            }
          : {}) as Record<string, unknown>),
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
      if (this.protocol === "chat_completions") {
        for await (const chunk of this.streamChatCompletionChunks(messages, merged, runManager)) {
          yield chunk;
        }
        return;
      }

      const stream = this.client.responses.stream(
        this.buildResponsesStreamingRequest(messages, merged),
      );
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

  private buildResponsesRequest(
    messages: BaseMessage[],
    options: Partial<OpenAIDeepAgentsChatCallOptions>,
  ) {
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

  private buildResponsesStreamingRequest(
    messages: BaseMessage[],
    options: Partial<OpenAIDeepAgentsChatCallOptions>,
  ) {
    return {
      ...this.buildResponsesRequest(messages, options),
      stream: true as const,
    };
  }

  private buildChatCompletionsRequest(
    messages: BaseMessage[],
    options: Partial<OpenAIDeepAgentsChatCallOptions>,
  ): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
    const request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      temperature: this.temperature,
      messages: messages.map((message) => toChatCompletionMessage(message)),
    };

    const tools = Array.isArray(options.tools) ? options.tools.filter(isChatCompletionTool) : [];
    if (tools.length > 0) {
      request.tools = tools;
    }

    const toolChoice = formatChatCompletionToolChoice(options.tool_choice);
    if (toolChoice !== undefined) {
      request.tool_choice = toolChoice;
    }

    if (typeof options.parallel_tool_calls === "boolean") {
      request.parallel_tool_calls = options.parallel_tool_calls;
    }

    return request;
  }

  private async generateResponsesMessage(
    messages: BaseMessage[],
    options: Partial<OpenAIDeepAgentsChatCallOptions>,
  ) {
    const response = await this.client.responses.create(this.buildResponsesRequest(messages, options));
    return toResponsesAiMessage(response);
  }

  private async generateChatCompletionMessage(
    messages: BaseMessage[],
    options: Partial<OpenAIDeepAgentsChatCallOptions>,
  ) {
    const response = await this.client.chat.completions.create(
      this.buildChatCompletionsRequest(messages, options),
    );
    return toChatCompletionAiMessage(response);
  }

  private async *streamChatCompletionChunks(
    messages: BaseMessage[],
    options: Partial<OpenAIDeepAgentsChatCallOptions>,
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const stream = await this.client.chat.completions.create({
      ...this.buildChatCompletionsRequest(messages, options),
      stream: true,
    });

    for await (const event of stream) {
      const chunk = toChatGenerationChunk(event);
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

function toResponsesAiMessage(response: OpenAI.Responses.Response) {
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

function toChatCompletionAiMessage(response: OpenAI.Chat.ChatCompletion) {
  const message = response.choices[0]?.message;

  return new AIMessage({
    content: normalizeChatCompletionMessageContent(message?.content),
    tool_calls: (message?.tool_calls ?? [])
      .filter((toolCall) => toolCall.type === "function")
      .map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function.name,
        args: parseToolArgs(toolCall.function.arguments),
        type: "tool_call" as const,
      })),
    response_metadata: {
      id: response.id,
      model: response.model,
      finish_reason: response.choices[0]?.finish_reason ?? null,
    },
    ...(response.usage
      ? {
          usage_metadata: {
            input_tokens: response.usage.prompt_tokens ?? 0,
            output_tokens: response.usage.completion_tokens ?? 0,
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

function isChatCompletionTool(tool: unknown): tool is OpenAI.Chat.ChatCompletionTool {
  return (
    typeof tool === "object" &&
    tool !== null &&
    "type" in tool &&
    tool.type === "function"
  );
}

function formatChatCompletionToolChoice(
  toolChoice: unknown,
): OpenAI.Chat.ChatCompletionToolChoiceOption | undefined {
  const formatted = formatToolChoice(toolChoice);
  if (!formatted || formatted === "required" || formatted === "auto" || formatted === "none") {
    return formatted as OpenAI.Chat.ChatCompletionToolChoiceOption | undefined;
  }
  return formatted as OpenAI.Chat.ChatCompletionToolChoiceOption;
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

function normalizeChatCompletionMessageContent(
  content: string | Array<OpenAI.Chat.ChatCompletionContentPartText | OpenAI.Chat.ChatCompletionContentPartRefusal> | null | undefined,
) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function toChatGenerationChunk(
  event: OpenAI.Chat.ChatCompletionChunk,
): ChatGenerationChunk | null {
  const delta = event.choices[0]?.delta;
  if (!delta) {
    return null;
  }

  const text = delta.content ?? "";
  const toolCallChunks = (delta.tool_calls ?? [])
    .filter((toolCall) => toolCall.type === "function")
    .map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function?.name,
      args: toolCall.function?.arguments,
      index: toolCall.index,
      type: "tool_call_chunk" as const,
    }));

  if (!text && toolCallChunks.length === 0) {
    return null;
  }

  return new ChatGenerationChunk({
    text,
    message: new AIMessageChunk({
      content: text,
      tool_call_chunks: toolCallChunks,
    }),
    generationInfo: {
      finish_reason: event.choices[0]?.finish_reason ?? null,
      model: event.model,
      id: event.id,
    },
  });
}

function toChatCompletionMessage(
  message: BaseMessage,
): OpenAI.Chat.ChatCompletionMessageParam {
  const type = message._getType();
  const record = asRecord(message);

  switch (type) {
    case "system":
      return {
        role: "system",
        content: normalizeChatCompletionTextContent(message.content),
      };
    case "human":
      return {
        role: "user",
        content: normalizeChatCompletionInputContent(message.content, true),
      };
    case "tool":
      return {
        role: "tool",
        content: normalizeChatCompletionTextContent(message.content),
        tool_call_id:
          typeof record?.tool_call_id === "string"
            ? record.tool_call_id
            : typeof record?.tool_callId === "string"
              ? record.tool_callId
              : "",
      };
    case "ai":
      return {
        role: "assistant",
        content: normalizeAssistantContent(message.content),
        ...(Array.isArray(record?.tool_calls)
          ? {
              tool_calls: record.tool_calls
                .map(toChatCompletionToolCall)
                .filter((toolCall): toolCall is OpenAI.Chat.ChatCompletionMessageToolCall => Boolean(toolCall)),
            }
          : {}),
      };
    default:
      return {
        role: "user",
        content: normalizeChatCompletionTextContent(message.content),
      };
  }
}

function normalizeAssistantContent(content: unknown) {
  const text = normalizeChatCompletionTextContent(content);
  return text.length > 0 ? text : null;
}

function normalizeChatCompletionInputContent(content: unknown, allowImages: boolean) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const parts = content
    .map((block) => toChatCompletionContentPart(block, allowImages))
    .filter((part): part is OpenAI.Chat.ChatCompletionContentPart => Boolean(part));

  if (parts.length === 0) {
    return "";
  }

  return parts;
}

function normalizeChatCompletionTextContent(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      const record = asRecord(block);
      return record?.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .join("");
}

function toChatCompletionContentPart(
  block: unknown,
  allowImages: boolean,
): OpenAI.Chat.ChatCompletionContentPart | null {
  const record = asRecord(block);
  if (!record) {
    return null;
  }

  if (record.type === "text" && typeof record.text === "string") {
    return {
      type: "text",
      text: record.text,
    };
  }

  if (
    allowImages &&
    record.type === "image_url" &&
    typeof asRecord(record.image_url)?.url === "string"
  ) {
    const imageUrl = asRecord(record.image_url);
    if (!imageUrl || typeof imageUrl.url !== "string") {
      return null;
    }

    return {
      type: "image_url",
      image_url: {
        url: imageUrl.url,
      },
    };
  }

  return null;
}

function toChatCompletionToolCall(
  toolCall: unknown,
): OpenAI.Chat.ChatCompletionMessageToolCall | null {
  const record = asRecord(toolCall);
  if (!record || typeof record.name !== "string") {
    return null;
  }

  return {
    id: typeof record.id === "string" ? record.id : `call_${Math.random().toString(36).slice(2, 10)}`,
    type: "function",
    function: {
      name: record.name,
      arguments: JSON.stringify(record.args ?? {}),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
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
