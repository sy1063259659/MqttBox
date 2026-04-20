import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { TypedEventBus } from "../harness/event-bus.js";
import { createDeepAgentTools } from "./deepagents-tool-bridge.js";

vi.mock("@langchain/core/tools", () => ({
  tool: (handler: (input: unknown) => Promise<unknown>, options: Record<string, unknown>) => ({
    ...options,
    invoke: handler,
  }),
}));

describe("createDeepAgentTools", () => {
  it("wraps registry definitions and executes them through ToolRunner", async () => {
    const execute = vi.fn(async () => ({
      ok: true,
      output: { result: "ok" },
    }));
    const tools = createDeepAgentTools({
      sessionId: "session-1",
      runId: "run-1",
      eventBus: new TypedEventBus(),
      toolRunner: {
        execute,
      } as never,
      toolDefinitions: [
        {
          name: "list_workspace_memories",
          description: "List memories",
          inputSchema: {},
          runtimeSchema: z.object({
            limit: z.number().optional(),
          }),
          handler: vi.fn(),
        },
      ],
    });

    expect(tools).toHaveLength(1);
    await expect((tools[0] as { invoke: (input: unknown) => Promise<unknown> }).invoke({ limit: 3 })).resolves.toEqual({
      result: "ok",
    });
    expect(execute).toHaveBeenCalledWith(
      "list_workspace_memories",
      { limit: 3 },
      expect.objectContaining({
        sessionId: "session-1",
        runId: "run-1",
      }),
    );
  });

  it("omits definitions without runtime schemas and surfaces execution failures", async () => {
    const execute = vi.fn(async () => ({
      ok: false,
      output: null,
      error: "tool failed",
    }));
    const tools = createDeepAgentTools({
      sessionId: "session-1",
      runId: null,
      eventBus: new TypedEventBus(),
      toolRunner: {
        execute,
      } as never,
      toolDefinitions: [
        {
          name: "no_runtime_schema",
          description: "Should not be bridged",
          inputSchema: {},
          handler: vi.fn(),
        },
        {
          name: "describe_parser_helpers",
          description: "Describe helpers",
          inputSchema: {},
          runtimeSchema: z.object({}),
          handler: vi.fn(),
        },
        {
          name: "save_parser_draft",
          description: "Save parser draft",
          inputSchema: {},
          runtimeSchema: z.object({
            name: z.string(),
            script: z.string(),
          }),
          requiresApproval: true,
          handler: vi.fn(),
        },
      ],
    });

    expect(tools).toHaveLength(1);
    await expect((tools[0] as { invoke: (input: unknown) => Promise<unknown> }).invoke({})).rejects.toThrow(
      "tool failed",
    );
  });
});
