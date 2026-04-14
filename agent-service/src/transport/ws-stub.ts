import type { AgentEvent } from "@agent-contracts";
import type { Logger } from "../observability/logger.js";
import type { AgentTransport, TransportEventHandler } from "./types.js";

export class WsTransportStub implements AgentTransport {
  constructor(private readonly logger: Logger) {}

  async start(): Promise<void> {
    this.logger.info("websocket transport stub initialized");
  }

  async stop(): Promise<void> {
    this.logger.info("websocket transport stub stopped");
  }

  async publish(_event: AgentEvent): Promise<void> {
    return Promise.resolve();
  }

  subscribe(_handler: TransportEventHandler): () => void {
    return () => undefined;
  }
}
