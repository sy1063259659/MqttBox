import type { AgentSafetyLevel, AgentSessionMode } from "@agent-contracts";

const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

export interface PolicyEngineConfig {
  maxSessionsPerMinute?: number;
  maxSessionsPerHour?: number;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

const DEFAULT_CONFIG: Required<PolicyEngineConfig> = {
  maxSessionsPerMinute: 10,
  maxSessionsPerHour: 100,
};

export class PolicyEngine {
  private readonly config: Required<PolicyEngineConfig>;
  private readonly sessionStarts: number[] = [];

  constructor(config: PolicyEngineConfig = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  canStartSession(_mode: AgentSessionMode, _safetyLevel: AgentSafetyLevel): PolicyDecision {
    const now = Date.now();
    this.prune(now);

    const sessionsLastMinute = this.countSince(now - ONE_MINUTE_MS);
    if (sessionsLastMinute >= this.config.maxSessionsPerMinute) {
      return {
        allowed: false,
        reason: `Session rate limit exceeded: ${this.config.maxSessionsPerMinute} per minute`,
      };
    }

    const sessionsLastHour = this.countSince(now - ONE_HOUR_MS);
    if (sessionsLastHour >= this.config.maxSessionsPerHour) {
      return {
        allowed: false,
        reason: `Session rate limit exceeded: ${this.config.maxSessionsPerHour} per hour`,
      };
    }

    this.sessionStarts.push(now);
    return { allowed: true };
  }

  private prune(now: number): void {
    const cutoff = now - ONE_HOUR_MS;
    while (this.sessionStarts.length > 0 && this.sessionStarts[0] < cutoff) {
      this.sessionStarts.shift();
    }
  }

  private countSince(cutoff: number): number {
    let count = 0;
    for (let index = this.sessionStarts.length - 1; index >= 0; index -= 1) {
      if (this.sessionStarts[index] >= cutoff) {
        count += 1;
        continue;
      }
      break;
    }

    return count;
  }
}
