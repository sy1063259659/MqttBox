import { randomUUID } from "node:crypto";
import type { ToolResultPayload } from "@agent-contracts";
import { ToolRegistry } from "./registry.js";
import { toToolDescriptor, type ToolContext, type ToolResult } from "./types.js";

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

export class ToolRunner {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly defaultTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS,
  ) {}

  async execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.registry.get(name);
    if (!tool) {
      const result = {
        ok: false,
        output: null,
        error: `Tool not found: ${name}`,
      } satisfies ToolResult;
      this.publishResult(name, context, result);
      return result;
    }

    const callId = randomUUID();
    const descriptor = toToolDescriptor(tool);
    context.eventBus.publish({
      id: randomUUID(),
      type: "tool.request",
      timestamp: new Date().toISOString(),
      sessionId: context.sessionId,
      runId: context.runId,
      payload: {
        callId,
        stepId: context.stepId ?? null,
        tool: descriptor,
        input,
      },
    });

    try {
      const result = await this.withTimeout(
        tool.handler(input, context),
        tool.timeoutMs ?? this.defaultTimeoutMs,
        name,
      );
      this.publishResult(descriptor.id, context, result, callId);
      return result;
    } catch (error) {
      const result = {
        ok: false,
        output: null,
        error: error instanceof Error ? error.message : `Tool execution failed: ${name}`,
      } satisfies ToolResult;
      this.publishResult(descriptor.id, context, result, callId);
      return result;
    }
  }

  private publishResult(
    toolId: string,
    context: ToolContext,
    result: ToolResult,
    callId = randomUUID(),
  ): void {
    const payload: ToolResultPayload = {
      callId,
      stepId: context.stepId ?? null,
      toolId,
      ok: result.ok,
      output: result.output,
      error: result.error ?? null,
    };

    context.eventBus.publish({
      id: randomUUID(),
      type: "tool.result",
      timestamp: new Date().toISOString(),
      sessionId: context.sessionId,
      runId: context.runId,
      payload,
    });
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    name: string,
  ): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool timed out: ${name} (${timeoutMs}ms)`));
      }, timeoutMs);

      void promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}
