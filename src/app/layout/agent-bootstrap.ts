import {
  isAgentServiceUnreachableError,
  syncAgentServiceConfig,
} from "@/services/agent-service";
import type { AgentSettingsDto } from "@/services/tauri";

export const AGENT_STARTUP_CONFIG_PENDING_MESSAGE =
  "Local agent service is running, but the saved model config has not synced yet.";

const AGENT_STARTUP_CONFIG_FAILED_PREFIX = "Failed to restore saved agent model config.";

interface RestoreAgentServiceRuntimeDeps {
  loadServiceConfig: () => Promise<void>;
  loadServiceHealth: () => Promise<void>;
  setStatusMessage: (message: string | null) => void;
  syncConfig?: typeof syncAgentServiceConfig;
}

export async function restoreAgentServiceRuntime(
  agentSettings: AgentSettingsDto,
  deps: RestoreAgentServiceRuntimeDeps,
) {
  try {
    await (deps.syncConfig ?? syncAgentServiceConfig)(agentSettings);
  } catch (error) {
    const statusMessage = isAgentServiceUnreachableError(error)
      ? AGENT_STARTUP_CONFIG_PENDING_MESSAGE
      : error instanceof Error
        ? `${AGENT_STARTUP_CONFIG_FAILED_PREFIX} ${error.message}`
        : AGENT_STARTUP_CONFIG_FAILED_PREFIX;

    deps.setStatusMessage(statusMessage);
    return {
      restored: false as const,
      statusMessage,
    };
  }

  await deps.loadServiceHealth();
  await deps.loadServiceConfig();

  return {
    restored: true as const,
    statusMessage: null,
  };
}
