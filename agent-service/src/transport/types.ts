import type { AgentEvent } from "@agent-contracts";

export type TransportEventHandler = (event: AgentEvent) => void;

export interface AgentTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  publish(event: AgentEvent): Promise<void>;
  subscribe(handler: TransportEventHandler): () => void;
}
