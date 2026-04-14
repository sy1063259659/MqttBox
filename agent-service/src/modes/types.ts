import type { AgentAttachmentDto, AgentSessionDto } from "@agent-contracts";
import type { ModelClient } from "../models/types.js";
import type { PromptRegistry } from "../prompts/index.js";

export interface ModeInput {
  session: AgentSessionDto;
  message: string;
  attachments: AgentAttachmentDto[];
  onDelta?: (delta: string) => void;
  capabilityId?: string | null;
}

export interface ModeHandler {
  respond(input: ModeInput): Promise<string>;
}

export interface ModeHandlerDeps {
  modelClient: ModelClient;
  promptRegistry: PromptRegistry;
}
