import { OpenAIModelClient } from "./openai-model.js";
import type { ModelClient } from "./types.js";

export type ModelProvider = "openai";

export interface ModelFactoryInput {
  provider: ModelProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  enabled?: boolean;
}

export function createModelClient(input: ModelFactoryInput): ModelClient {
  switch (input.provider) {
    case "openai":
      return new OpenAIModelClient({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        model: input.model,
        enabled: input.enabled,
      });
    default: {
      const neverProvider: never = input.provider;
      throw new Error(`Unsupported model provider: ${String(neverProvider)}`);
    }
  }
}
