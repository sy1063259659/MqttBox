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
import { WsTransportStub } from "./transport/ws-stub.js";

async function main(): Promise<void> {
  const logger = new Logger("agent-service");
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
  const wsTransport = new WsTransportStub(logger);
  const harness = new AgentHarness({
    logger,
    sessionStore,
    transport,
    wsTransport,
    promptRegistry,
    policyEngine: new PolicyEngine(),
    scheduler: new RunScheduler(),
    budgetManager: new BudgetManager(),
    capabilityRegistry: new CapabilityRegistry(),
    memoryStore: new MemoryStore(),
    artifactStore: new ArtifactStore(),
    deepAgentsAdapter: new DeepAgentsAdapter(logger),
    modelClient,
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
