import { tool } from "@langchain/core/tools";
import type { TypedEventBus } from "../harness/event-bus.js";
import type { ToolDefinition, ToolRunner } from "../tools/index.js";

export interface DeepAgentToolBridgeInput {
  sessionId: string;
  runId: string | null;
  eventBus: TypedEventBus;
  toolRunner: ToolRunner;
  toolDefinitions: ToolDefinition[];
}

export function createDeepAgentTools(input: DeepAgentToolBridgeInput) {
  return input.toolDefinitions.flatMap((definition) => {
    if (!definition.runtimeSchema) {
      return [];
    }

    return [
      tool(
        async (toolInput) => {
          const result = await input.toolRunner.execute(definition.name, toolInput, {
            sessionId: input.sessionId,
            runId: input.runId,
            eventBus: input.eventBus,
          });

          if (!result.ok) {
            throw new Error(result.error ?? `Tool execution failed: ${definition.name}`);
          }

          return result.output ?? null;
        },
        {
          name: definition.name,
          description: definition.description,
          schema: definition.runtimeSchema,
        },
      ),
    ];
  });
}
