import OpenAI from "openai";
import {
  ModelClient,
  ModelClientError,
  ModelRequest,
  ModelResponse,
  ModelProtocol,
  ModelRuntimeConfig,
  ModelRuntimeSnapshot,
} from "./types.js";

export interface OpenAIModelClientOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  enabled?: boolean;
  protocol?: ModelProtocol;
}

export class OpenAIModelClient implements ModelClient {
  readonly provider = "openai";
  private readonly options: OpenAIModelClientOptions;
  private enabled: boolean;
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private protocol: ModelProtocol;
  private client: OpenAI | null = null;

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (!this.enabled) {
      throw new ModelClientError("agent_disabled", "Agent model is disabled", false);
    }

    if (!this.apiKey.trim()) {
      throw new ModelClientError("missing_api_key", "OpenAI API key is missing", false);
    }

    const client = this.getClient();

    try {
      if (request.onDelta) {
        return this.generateStreamingResponse(client, request);
      }

      return this.generateSingleResponse(client, request);
    } catch (error) {
      if (error instanceof ModelClientError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "OpenAI request failed";
      throw new ModelClientError("openai_request_failed", message);
    }
  }

  configure(config: ModelRuntimeConfig): void {
    if (typeof config.enabled === "boolean") {
      this.enabled = config.enabled;
    }
    if (typeof config.apiKey === "string") {
      this.apiKey = config.apiKey;
    }
    if (typeof config.baseUrl === "string" && config.baseUrl.trim()) {
      this.baseUrl = config.baseUrl.trim();
    }
    if (typeof config.model === "string" && config.model.trim()) {
      this.model = config.model.trim();
    }
    if (config.protocol === "responses" || config.protocol === "chat_completions") {
      this.protocol = config.protocol;
    }
    this.client = null;
  }

  getConfigSummary() {
    return {
      provider: this.provider,
      configured: this.apiKey.length > 0,
      model: this.model,
      baseUrl: this.baseUrl,
      enabled: this.enabled,
      protocol: this.protocol,
    };
  }

  getRuntimeConfig(): ModelRuntimeSnapshot {
    return {
      provider: this.provider,
      enabled: this.enabled,
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      model: this.model,
      protocol: this.protocol,
    };
  }

  private get defaultBaseUrl() {
    return this.options.baseUrl?.trim() || "https://api.openai.com/v1";
  }

  private get defaultModel() {
    return this.options.model?.trim() || "gpt-5.4";
  }

  private get defaultEnabled() {
    return this.options.enabled ?? false;
  }

  private get defaultProtocol() {
    return this.options.protocol ?? "responses";
  }

  constructor(options: OpenAIModelClientOptions) {
    this.options = options;
    this.enabled = this.defaultEnabled;
    this.apiKey = options.apiKey?.trim() || "";
    this.baseUrl = this.defaultBaseUrl;
    this.model = this.defaultModel;
    this.protocol = this.defaultProtocol;
  }

  private getClient() {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: this.baseUrl,
      });
    }

    return this.client;
  }

  private async generateStreamingResponse(
    client: OpenAI,
    request: ModelRequest,
  ): Promise<ModelResponse> {
    if (this.protocol === "chat_completions") {
      const stream = await client.chat.completions.create({
        ...this.buildChatCompletionsRequest(request),
        stream: true,
      });

      let content = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (!delta) {
          continue;
        }

        content += delta;
        request.onDelta?.(delta);
      }

      return { content: this.ensureResponseText(content) };
    }

    const stream = client.responses.stream({
      ...this.buildResponsesRequest(request),
      stream: true,
    });

    let content = "";
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        content += event.delta;
        request.onDelta?.(event.delta);
      }
    }

    if (!content.trim()) {
      const finalResponse = await stream.finalResponse();
      return { content: this.ensureResponseText(finalResponse.output_text?.trim() ?? "") };
    }

    return { content: this.ensureResponseText(content) };
  }

  private async generateSingleResponse(client: OpenAI, request: ModelRequest): Promise<ModelResponse> {
    if (this.protocol === "chat_completions") {
      const response = await client.chat.completions.create(this.buildChatCompletionsRequest(request));
      return { content: this.ensureResponseText(response.choices[0]?.message?.content ?? "") };
    }

    const response = await client.responses.create(this.buildResponsesRequest(request));
    return { content: this.ensureResponseText(response.output_text?.trim() ?? "") };
  }

  private buildResponsesRequest(request: ModelRequest): OpenAI.Responses.ResponseCreateParamsNonStreaming {
    return {
      model: this.model,
      instructions: request.systemPrompt,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: request.userMessage,
            },
            ...(request.attachments ?? []).map((attachment) => ({
              type: "input_image" as const,
              image_url: attachment.dataUrl,
              detail: "auto" as const,
            })),
          ],
        },
      ],
    };
  }

  private buildChatCompletionsRequest(
    request: ModelRequest,
  ): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
    return {
      model: this.model,
      messages: [
        {
          role: "system",
          content: request.systemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: request.userMessage,
            },
            ...(request.attachments ?? []).map((attachment) => ({
              type: "image_url" as const,
              image_url: {
                url: attachment.dataUrl,
                detail: "auto" as const,
              },
            })),
          ],
        },
      ],
    };
  }

  private ensureResponseText(value: string) {
    const content = value.trim();
    if (!content) {
      throw new ModelClientError("empty_response", "OpenAI returned an empty response");
    }
    if (isLikelyHtmlGatewayError(content)) {
      throw new ModelClientError(
        "openai_request_failed",
        "The configured OpenAI-compatible API returned an HTML gateway error page. Check the API base URL or upstream gateway status.",
      );
    }
    return content;
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
