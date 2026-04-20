import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolDescriptor } from "@agent-contracts";

vi.mock("@/services/agent-service", () => ({
  createAgentSession: vi.fn(),
  getAgentServiceConfig: vi.fn(),
  getAgentServiceHealth: vi.fn(),
  getAgentSessionDetail: vi.fn(),
  listAgentSessions: vi.fn(),
  resolveAgentApproval: vi.fn(),
  streamAgentMessage: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  getAgentContext: vi.fn(),
}));

import { getAgentServiceHealth } from "@/services/agent-service";
import { useAgentStore } from "@/stores/agent-store";

describe("useAgentStore.loadServiceHealth", () => {
  beforeEach(() => {
    useAgentStore.setState({
      capabilities: [],
      tools: [],
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
      tools: [],
      memories: 0,
      deepagentsRuntime: "deepagentsjs",
      model: {
        provider: "openai",
        configured: true,
        model: "gpt-5.4",
        baseUrl: "https://api.example.com/v1",
        enabled: false,
        protocol: "responses",
      },
    });

    await useAgentStore.getState().loadServiceHealth();

    expect(useAgentStore.getState().statusMessage).toBe("Agent model is disabled");
    expect(useAgentStore.getState().tools).toEqual([]);
  });

  it("keeps enabled-but-unconfigured models out of the disabled state and adopts live tools", async () => {
    const tools: ToolDescriptor[] = [
      {
        id: "list_saved_parsers",
        name: "list_saved_parsers",
        description: "List saved parsers",
        toolKind: "context",
        riskLevel: "low",
        allowedModes: ["chat", "execute"],
        minSafetyLevel: "observe",
        requiresApproval: false,
      },
    ];

    vi.mocked(getAgentServiceHealth).mockResolvedValueOnce({
      status: "ok",
      service: "agent-service",
      transport: "in-memory+ws",
      capabilities: [],
      tools,
      memories: 0,
      deepagentsRuntime: "deepagentsjs",
      model: {
        provider: "openai",
        configured: false,
        model: "gpt-5.4",
        baseUrl: "https://api.example.com/v1",
        enabled: true,
        protocol: "responses",
      },
    });

    await useAgentStore.getState().loadServiceHealth();

    expect(useAgentStore.getState().statusMessage).toBe(
      "Agent service is reachable, but the model is not configured",
    );
    expect(useAgentStore.getState().tools).toEqual(tools);
  });
});
