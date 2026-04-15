import { describe, expect, it, vi } from "vitest";
import type { AgentEventEnvelope } from "@agent-contracts";
import { TypedEventBus } from "./event-bus.js";

function createEvent(
  overrides: Partial<AgentEventEnvelope<"assistant.final">> = {},
): AgentEventEnvelope<"assistant.final"> {
  return {
    id: "evt-1",
    type: "assistant.final",
    timestamp: "2026-04-15T00:00:00.000Z",
    sessionId: "session-1",
    payload: {
      messageId: "msg-1",
      content: "done",
      finishReason: "stop",
    },
    ...overrides,
  };
}

describe("TypedEventBus", () => {
  it("publishes events to type subscribers", () => {
    const bus = new TypedEventBus();
    const handler = vi.fn();
    const event = createEvent();

    bus.subscribe("assistant.final", handler);
    bus.publish(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("publishes events to wildcard subscribers", () => {
    const bus = new TypedEventBus();
    const handler = vi.fn();
    const event = createEvent();

    bus.subscribeAll(handler);
    bus.publish(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("supports multiple subscribers for the same event", () => {
    const bus = new TypedEventBus();
    const first = vi.fn();
    const second = vi.fn();
    const event = createEvent();

    bus.subscribe("assistant.final", first);
    bus.subscribe("assistant.final", second);
    bus.publish(event);

    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledWith(event);
  });

  it("stops notifying a handler after unsubscribe", () => {
    const bus = new TypedEventBus();
    const handler = vi.fn();
    const event = createEvent();
    const unsubscribe = bus.subscribe("assistant.final", handler);

    unsubscribe();
    bus.publish(event);

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not invoke handlers subscribed to other event types", () => {
    const bus = new TypedEventBus();
    const handler = vi.fn();

    bus.subscribe("service.error", handler);
    bus.publish(createEvent());

    expect(handler).not.toHaveBeenCalled();
  });
});
