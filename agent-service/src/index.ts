import { AgentHarness } from "./harness/agent-harness.js";
import { HttpServer } from "./server/http-server.js";
import { ArtifactStore } from "./artifacts/index.js";
import { BudgetManager } from "./budget/index.js";
import { CapabilityRegistry } from "./capabilities/index.js";
import { DeepAgentsAdapter } from "./integrations/deepagents-adapter.js";
import { MemoryStore } from "./memory/index.js";
import { createModelClient } from "./models/factory.js";
import { Logger } from "./observability/logger.js";
import { RunScheduler } from "./scheduler/index.js";
import { InMemorySessionStore } from "./persistence/session-store.js";
import { PolicyEngine } from "./policy/index.js";
import { PromptRegistry } from "./prompts/index.js";
import { InMemoryTransport } from "./transport/inmemory-transport.js";
import { WsTransport } from "./transport/ws-transport.js";
import { registerBuiltinTools, ToolRegistry, ToolRunner } from "./tools/index.js";
import { TypedEventBus } from "./harness/event-bus.js";

async function main(): Promise<void> {
  const logger = new Logger("agent-service");
  const eventBus = new TypedEventBus();
  const sessionStore = new InMemorySessionStore();
  const promptRegistry = new PromptRegistry();
  const modelClient = createModelClient({
    provider: "openai",
    enabled: false,
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL,
  });
  const transport = new InMemoryTransport();
  const wsTransport = new WsTransport(logger, {
    port: Number(process.env.AGENT_WS_PORT ?? 8788),
  });
  const capabilityRegistry = new CapabilityRegistry();
  const memoryStore = new MemoryStore();
  const artifactStore = new ArtifactStore();
  const toolRegistry = new ToolRegistry();
  registerBuiltinTools({
    toolRegistry,
    capabilityRegistry,
    memoryStore,
    artifactStore,
  });
  const toolRunner = new ToolRunner(toolRegistry);
  const harness = new AgentHarness({
    logger,
    eventBus,
    sessionStore,
    transport,
    wsTransport,
    promptRegistry,
    policyEngine: new PolicyEngine(),
    scheduler: new RunScheduler({
      executor: async () => {},
    }),
    budgetManager: new BudgetManager(),
    capabilityRegistry,
    memoryStore,
    artifactStore,
    deepAgentsAdapter: new DeepAgentsAdapter(logger),
    modelClient,
    toolRegistry,
    toolRunner,
  });

  await harness.start();

  const port = Number(process.env.AGENT_SERVICE_PORT ?? 8787);
  const server = new HttpServer(harness, logger, port);
  await server.start();

  process.on("SIGINT", async () => {
    await server.stop();
    await harness.stop();
    process.exit(0);
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[agent-service] fatal error: ${message}`);
  process.exit(1);
});
