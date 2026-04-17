import type { CapabilityRegistry } from "../capabilities/index.js";
import type { ArtifactStore } from "../artifacts/index.js";
import type { MemoryStore } from "../memory/index.js";
import { listParserHelpers, PARSER_HELPER_USAGE_NOTE } from "./parser-helpers.js";
import type { ToolDefinition } from "./types.js";
import type { ToolRegistry } from "./registry.js";
import { z } from "zod";

const emptyObjectSchema = z.object({});

const emptyObjectJsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} satisfies Record<string, unknown>;

const listMemoriesInputSchema = z.object({
  scopeType: z.string().min(1).optional(),
  scopeRef: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

const listMemoriesJsonSchema = {
  type: "object",
  properties: {
    scopeType: { type: "string" },
    scopeRef: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 20 },
  },
  additionalProperties: false,
} satisfies Record<string, unknown>;

const listArtifactsInputSchema = z.object({
  limit: z.number().int().min(1).max(20).optional(),
});

const listArtifactsJsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 20 },
  },
  additionalProperties: false,
} satisfies Record<string, unknown>;

const describeHelpersInputSchema = z.object({
  names: z.array(z.string().min(1)).max(20).optional(),
});

const describeHelpersJsonSchema = {
  type: "object",
  properties: {
    names: {
      type: "array",
      items: { type: "string" },
      maxItems: 20,
    },
  },
  additionalProperties: false,
} satisfies Record<string, unknown>;

interface RegisterBuiltinToolsInput {
  toolRegistry: ToolRegistry;
  capabilityRegistry: CapabilityRegistry;
  memoryStore: MemoryStore;
  artifactStore: ArtifactStore;
}

export function registerBuiltinTools(input: RegisterBuiltinToolsInput): void {
  const tools: ToolDefinition[] = [
    {
      name: "list_agent_capabilities",
      description: "List the currently enabled agent capabilities and their supported modes.",
      inputSchema: emptyObjectJsonSchema,
      runtimeSchema: emptyObjectSchema,
      handler: async () => ({
        ok: true,
        output: {
          capabilities: input.capabilityRegistry.list(),
        },
      }),
    },
    {
      name: "list_registered_tools",
      description: "List the context tools currently exposed to the agent runtime.",
      inputSchema: emptyObjectJsonSchema,
      runtimeSchema: emptyObjectSchema,
      handler: async () => ({
        ok: true,
        output: {
          tools: input.toolRegistry.list(),
        },
      }),
    },
    {
      name: "list_workspace_memories",
      description: "List saved workspace memories so the agent can ground answers in remembered MQTT context.",
      inputSchema: listMemoriesJsonSchema,
      runtimeSchema: listMemoriesInputSchema,
      handler: async (rawInput) => {
        const parsed = listMemoriesInputSchema.parse(rawInput ?? {});
        const filtered = input.memoryStore
          .list()
          .filter((memory) => (parsed.scopeType ? memory.scopeType === parsed.scopeType : true))
          .filter((memory) => (parsed.scopeRef ? memory.scopeRef === parsed.scopeRef : true))
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const limit = parsed.limit ?? 5;

        return {
          ok: true,
          output: {
            items: filtered.slice(0, limit),
            total: filtered.length,
          },
        };
      },
    },
    {
      name: "list_recent_parser_artifacts",
      description: "List recent parser-script artifacts so the agent can reuse prior parser drafts instead of guessing.",
      inputSchema: listArtifactsJsonSchema,
      runtimeSchema: listArtifactsInputSchema,
      handler: async (rawInput) => {
        const parsed = listArtifactsInputSchema.parse(rawInput ?? {});
        const limit = parsed.limit ?? 5;
        const recentArtifacts = input.artifactStore
          .list()
          .filter((artifact) => artifact.type === "parser-script")
          .slice(0, limit);
        const artifacts = recentArtifacts.map((artifact) => {
            const payload = artifact.payload as Record<string, unknown>;
            const editorPayload = payload.editorPayload as Record<string, unknown> | undefined;
            const reviewPayload = payload.reviewPayload as Record<string, unknown> | undefined;
            return {
              id: artifact.id,
              runId: artifact.runId,
              title: artifact.title,
              summary: artifact.summary,
              createdAt: artifact.createdAt,
              parserName:
                typeof editorPayload?.name === "string" ? editorPayload.name : artifact.title,
              suggestedTopicFilter:
                typeof payload.suggestedTopicFilter === "string"
                  ? payload.suggestedTopicFilter
                  : null,
              reviewSummary:
                typeof reviewPayload?.summary === "string" ? reviewPayload.summary : artifact.summary,
            };
          });

        return {
          ok: true,
          output: {
            artifacts,
            total: recentArtifacts.length,
          },
        };
      },
    },
    {
      name: "describe_parser_helpers",
      description: "Describe the available parser helpers, including explicit BE/LE byte order helpers for binary payload parsing.",
      inputSchema: describeHelpersJsonSchema,
      runtimeSchema: describeHelpersInputSchema,
      handler: async (rawInput) => {
        const parsed = describeHelpersInputSchema.parse(rawInput ?? {});
        return {
          ok: true,
          output: {
            note: PARSER_HELPER_USAGE_NOTE,
            helpers: listParserHelpers(parsed.names),
          },
        };
      },
    },
  ];

  for (const tool of tools) {
    input.toolRegistry.register(tool);
  }
}
