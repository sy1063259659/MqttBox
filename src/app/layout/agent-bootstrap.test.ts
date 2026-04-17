import { describe, expect, it, vi } from "vitest";

import {
  AGENT_STARTUP_CONFIG_PENDING_MESSAGE,
  restoreAgentServiceRuntime,
} from "@/app/layout/agent-bootstrap";
import type { AgentSettingsDto } from "@/services/tauri";

const savedSettings: AgentSettingsDto = {
  enabled: true,
  provider: "openai",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test",
  model: "gpt-5.4",
};

describe("restoreAgentServiceRuntime", () => {
  it("syncs saved settings before loading health and config", async () => {
    const syncConfig = vi.fn(async () => ({
      ok: true as const,
      settings: {},
    }));
    const loadServiceHealth = vi.fn(async () => undefined);
    const loadServiceConfig = vi.fn(async () => undefined);
    const setStatusMessage = vi.fn();

    const result = await restoreAgentServiceRuntime(savedSettings, {
      syncConfig,
      loadServiceHealth,
      loadServiceConfig,
      setStatusMessage,
    });

    expect(result).toEqual({
      restored: true,
      statusMessage: null,
    });
    expect(syncConfig).toHaveBeenCalledWith(savedSettings);
    expect(loadServiceHealth).toHaveBeenCalledTimes(1);
    expect(loadServiceConfig).toHaveBeenCalledTimes(1);
    expect(setStatusMessage).not.toHaveBeenCalled();
  });

  it("keeps startup soft-failing when the local service is not ready", async () => {
    const syncConfig = vi.fn(async () => {
      throw Object.assign(new Error("service unavailable"), {
        code: "agent_service_unreachable",
      });
    });
    const loadServiceHealth = vi.fn(async () => undefined);
    const loadServiceConfig = vi.fn(async () => undefined);
    const setStatusMessage = vi.fn();

    const result = await restoreAgentServiceRuntime(savedSettings, {
      syncConfig,
      loadServiceHealth,
      loadServiceConfig,
      setStatusMessage,
    });

    expect(result).toEqual({
      restored: false,
      statusMessage: AGENT_STARTUP_CONFIG_PENDING_MESSAGE,
    });
    expect(loadServiceHealth).not.toHaveBeenCalled();
    expect(loadServiceConfig).not.toHaveBeenCalled();
    expect(setStatusMessage).toHaveBeenCalledWith(AGENT_STARTUP_CONFIG_PENDING_MESSAGE);
  });
});
