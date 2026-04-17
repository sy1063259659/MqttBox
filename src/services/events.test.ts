import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

import {
  registerAgentEvents,
  registerConnectionEvents,
  registerMessageEvents,
} from "@/services/events";

describe("events service", () => {
  it("returns noop listeners in web mode without touching Tauri listen", async () => {
    delete (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    const connectionCleanup = await registerConnectionEvents(() => undefined);
    const messageCleanup = await registerMessageEvents(() => undefined);
    const agentCleanup = await registerAgentEvents(() => undefined);

    expect(mocks.listen).not.toHaveBeenCalled();
    expect(connectionCleanup).toBeTypeOf("function");
    expect(messageCleanup).toBeTypeOf("function");
    expect(agentCleanup).toBeTypeOf("function");
  });
});
