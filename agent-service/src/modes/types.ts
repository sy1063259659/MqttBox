import type { AgentAttachmentDto, AgentSessionDto } from "@agent-contracts";
import type { TypedEventBus } from "../harness/event-bus.js";
import type { ModelClient } from "../models/types.js";
import type { PromptRegistry } from "../prompts/index.js";
import type { ToolRunner } from "../tools/index.js";

export interface ModeInput {
  session: AgentSessionDto;
  message: string;
  attachments: AgentAttachmentDto[];
  onDelta?: (delta: string) => void;
  capabilityId?: string | null;
  runId?: string | null;
  eventBus: TypedEventBus;
  toolRunner: ToolRunner;
}

export interface ModeHandler {
  respond(input: ModeInput): Promise<string>;
}

export interface ModeHandlerDeps {
  modelClient: ModelClient;
  promptRegistry: PromptRegistry;
  eventBus: TypedEventBus;
  toolRunner: ToolRunner;
}
