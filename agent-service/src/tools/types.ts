import type {
  AgentSafetyLevel,
  AgentSessionMode,
  ToolDescriptor,
} from "@agent-contracts";
import type { TypedEventBus } from "../harness/event-bus.js";
import type { ZodTypeAny } from "zod";

export interface ToolContext {
  sessionId: string;
  runId: string | null;
  eventBus: TypedEventBus;
  stepId?: string | null;
}

export interface ToolResult {
  ok: boolean;
  output: unknown;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  runtimeSchema?: ZodTypeAny;
  handler: (input: unknown, context: ToolContext) => Promise<ToolResult>;
  timeoutMs?: number;
  toolKind?: ToolDescriptor["toolKind"];
  riskLevel?: ToolDescriptor["riskLevel"];
  allowedModes?: AgentSessionMode[];
  minSafetyLevel?: AgentSafetyLevel;
  requiresApproval?: boolean;
  outputSchema?: ToolDescriptor["outputSchema"];
  retryPolicy?: ToolDescriptor["retryPolicy"];
  idempotent?: boolean;
}

export function toToolDescriptor(tool: ToolDefinition): ToolDescriptor {
  return {
    id: tool.name,
    name: tool.name,
    description: tool.description,
    toolKind: tool.toolKind ?? "context",
    riskLevel: tool.riskLevel ?? "low",
    allowedModes: tool.allowedModes ?? ["chat", "execute"],
    minSafetyLevel: tool.minSafetyLevel ?? "observe",
    requiresApproval: tool.requiresApproval ?? false,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema ?? null,
    timeoutMs: tool.timeoutMs ?? null,
    retryPolicy: tool.retryPolicy ?? null,
    idempotent: tool.idempotent ?? true,
  };
}
