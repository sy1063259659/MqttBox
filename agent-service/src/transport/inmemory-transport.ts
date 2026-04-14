import type { AgentEvent } from "@agent-contracts";
import type { AgentTransport, TransportEventHandler } from "./types.js";

export class InMemoryTransport implements AgentTransport {
  private readonly handlers = new Set<TransportEventHandler>();

  async start(): Promise<void> {
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    this.handlers.clear();
    return Promise.resolve();
  }

  async publish(event: AgentEvent): Promise<void> {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  subscribe(handler: TransportEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
