import type { AgentSafetyLevel, AgentSessionMode } from "@agent-contracts";

export class PolicyEngine {
  canStartSession(_mode: AgentSessionMode, _safetyLevel: AgentSafetyLevel): boolean {
    return true;
  }
}
