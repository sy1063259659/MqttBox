import { EventEmitter } from "node:events";
import type { AgentEvent, AgentEventEnvelope, AgentEventType } from "@agent-contracts";

type EventHandler<TType extends AgentEventType> = (event: AgentEventEnvelope<TType>) => void;
type AnyEventHandler = (event: AgentEvent) => void;

export class TypedEventBus {
  private readonly emitter = new EventEmitter();

  publish<TType extends AgentEventType>(event: AgentEventEnvelope<TType>): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit("*", event);
  }

  subscribe<TType extends AgentEventType>(type: TType, handler: EventHandler<TType>): () => void {
    const wrapped = (event: AgentEventEnvelope<TType>) => handler(event);
    this.emitter.on(type, wrapped);
    return () => this.emitter.off(type, wrapped);
  }

  subscribeAll(handler: AnyEventHandler): () => void {
    this.emitter.on("*", handler);
    return () => this.emitter.off("*", handler);
  }
}
