import OpenAI from "openai";
import {
  ModelClient,
  ModelClientError,
  ModelRequest,
  ModelResponse,
  ModelRuntimeConfig,
  ModelRuntimeSnapshot,
} from "./types.js";

export interface OpenAIModelClientOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  enabled?: boolean;
}

export class OpenAIModelClient implements ModelClient {
  readonly provider = "openai";
  private readonly options: OpenAIModelClientOptions;
  private enabled: boolean;
  private apiKey: string;
  private baseUrl: string;
  private model: string;
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
        const stream = client.responses.stream({
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
        });

        let content = "";
        for await (const event of stream) {
          if (event.type === "response.output_text.delta") {
            content += event.delta;
            request.onDelta(event.delta);
          }
        }

        if (!content.trim()) {
          const finalResponse = await stream.finalResponse();
          const fallback = finalResponse.output_text?.trim() ?? "";
          if (!fallback) {
            throw new ModelClientError("empty_response", "OpenAI returned an empty response");
          }
          if (isLikelyHtmlGatewayError(fallback)) {
            throw new ModelClientError(
              "openai_request_failed",
              "The configured OpenAI-compatible API returned an HTML gateway error page. Check the API base URL or upstream gateway status.",
            );
          }
          return { content: fallback };
        }

        if (isLikelyHtmlGatewayError(content)) {
          throw new ModelClientError(
            "openai_request_failed",
            "The configured OpenAI-compatible API returned an HTML gateway error page. Check the API base URL or upstream gateway status.",
          );
        }

        return { content };
      }

      const response = await client.responses.create({
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
      });

      const content = response.output_text?.trim();
      if (!content) {
        throw new ModelClientError("empty_response", "OpenAI returned an empty response");
      }
      if (isLikelyHtmlGatewayError(content)) {
        throw new ModelClientError(
          "openai_request_failed",
          "The configured OpenAI-compatible API returned an HTML gateway error page. Check the API base URL or upstream gateway status.",
        );
      }

      return { content };
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
    this.client = null;
  }

  getConfigSummary() {
    return {
      provider: this.provider,
      configured: this.apiKey.length > 0,
      model: this.model,
      baseUrl: this.baseUrl,
      enabled: this.enabled,
    };
  }

  getRuntimeConfig(): ModelRuntimeSnapshot {
    return {
      provider: this.provider,
      enabled: this.enabled,
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      model: this.model,
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

  constructor(options: OpenAIModelClientOptions) {
    this.options = options;
    this.enabled = this.defaultEnabled;
    this.apiKey = options.apiKey?.trim() || "";
    this.baseUrl = this.defaultBaseUrl;
    this.model = this.defaultModel;
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
