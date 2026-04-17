import type { AgentAttachmentDto, AgentSessionMode } from "@agent-contracts";

export interface ModelRuntimeConfig {
  enabled?: boolean;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface ModelRuntimeSnapshot {
  provider: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ModelRequest {
  mode: AgentSessionMode;
  systemPrompt: string;
  userMessage: string;
  attachments?: AgentAttachmentDto[];
  onDelta?: (delta: string) => void;
}

export interface ModelResponse {
  content: string;
}

export class ModelClientError extends Error {
  readonly code: string;
  readonly recoverable: boolean;

  constructor(code: string, message: string, recoverable = true) {
    super(message);
    this.name = "ModelClientError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export interface ModelClient {
  provider: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
  configure(config: ModelRuntimeConfig): void;
  getRuntimeConfig(): ModelRuntimeSnapshot;
  getConfigSummary(): {
    provider: string;
    configured: boolean;
    model: string;
    baseUrl: string;
    enabled: boolean;
  };
}
