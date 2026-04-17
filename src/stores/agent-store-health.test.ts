import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/agent-service", () => ({
  createAgentSession: vi.fn(),
  getAgentServiceConfig: vi.fn(),
  getAgentServiceHealth: vi.fn(),
  resolveAgentApproval: vi.fn(),
  streamAgentMessage: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  getAgentContext: vi.fn(),
  listAgentTools: vi.fn(),
}));

import { getAgentServiceHealth } from "@/services/agent-service";
import { useAgentStore } from "@/stores/agent-store";

describe("useAgentStore.loadServiceHealth", () => {
  beforeEach(() => {
    useAgentStore.setState({
      capabilities: [],
      statusMessage: null,
    });
    vi.clearAllMocks();
  });

  it("surfaces disabled only when the synced model config is disabled", async () => {
    vi.mocked(getAgentServiceHealth).mockResolvedValueOnce({
      status: "ok",
      service: "agent-service",
      transport: "in-memory+ws",
      capabilities: [],
      memories: 0,
      deepagentsRuntime: "deepagentsjs",
      model: {
        provider: "openai",
        configured: true,
        model: "gpt-5.4",
        baseUrl: "https://api.example.com/v1",
        enabled: false,
      },
    });

    await useAgentStore.getState().loadServiceHealth();

    expect(useAgentStore.getState().statusMessage).toBe("Agent model is disabled");
  });

  it("keeps enabled-but-unconfigured models out of the disabled state", async () => {
    vi.mocked(getAgentServiceHealth).mockResolvedValueOnce({
      status: "ok",
      service: "agent-service",
      transport: "in-memory+ws",
      capabilities: [],
      memories: 0,
      deepagentsRuntime: "deepagentsjs",
      model: {
        provider: "openai",
        configured: false,
        model: "gpt-5.4",
        baseUrl: "https://api.example.com/v1",
        enabled: true,
      },
    });

    await useAgentStore.getState().loadServiceHealth();

    expect(useAgentStore.getState().statusMessage).toBe(
      "Agent service is reachable, but the model is not configured",
    );
  });
});
