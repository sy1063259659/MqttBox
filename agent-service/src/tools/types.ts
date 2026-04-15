import type { ToolDescriptor } from "@agent-contracts";
import type { TypedEventBus } from "../harness/event-bus.js";

export interface ToolContext {
  sessionId: string;
  runId: string;
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
  handler: (input: unknown, context: ToolContext) => Promise<ToolResult>;
  timeoutMs?: number;
}

export function toToolDescriptor(tool: ToolDefinition): ToolDescriptor {
  return {
    id: tool.name,
    name: tool.name,
    description: tool.description,
    toolKind: "context",
    riskLevel: "low",
    allowedModes: ["chat", "execute"],
    minSafetyLevel: "observe",
    requiresApproval: false,
    inputSchema: tool.inputSchema,
    outputSchema: null,
    timeoutMs: tool.timeoutMs ?? null,
    retryPolicy: null,
    idempotent: true,
  };
}
