import { beforeEach, describe, expect, it, vi } from "vitest";
import { PolicyEngine } from "./index.js";

describe("PolicyEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));
  });

  it("allows session creation within the default limits", () => {
    const policy = new PolicyEngine();

    expect(policy.canStartSession("chat", "observe")).toEqual({ allowed: true });
    expect(policy.canStartSession("execute", "confirm")).toEqual({ allowed: true });
  });

  it("blocks when the per-minute limit is exceeded", () => {
    const policy = new PolicyEngine({
      maxSessionsPerMinute: 2,
      maxSessionsPerHour: 10,
    });

    expect(policy.canStartSession("chat", "observe")).toEqual({ allowed: true });
    expect(policy.canStartSession("chat", "observe")).toEqual({ allowed: true });
    expect(policy.canStartSession("chat", "observe")).toEqual({
      allowed: false,
      reason: "Session rate limit exceeded: 2 per minute",
    });
  });

  it("expires minute-window entries with sliding-window behavior", () => {
    const policy = new PolicyEngine({
      maxSessionsPerMinute: 2,
      maxSessionsPerHour: 10,
    });

    expect(policy.canStartSession("chat", "observe")).toEqual({ allowed: true });
    vi.advanceTimersByTime(30_000);
    expect(policy.canStartSession("chat", "observe")).toEqual({ allowed: true });
    vi.advanceTimersByTime(30_001);

    expect(policy.canStartSession("chat", "observe")).toEqual({ allowed: true });
  });

  it("blocks when the per-hour limit is exceeded", () => {
    const policy = new PolicyEngine({
      maxSessionsPerMinute: 10,
      maxSessionsPerHour: 2,
    });

    expect(policy.canStartSession("chat", "observe")).toEqual({ allowed: true });
    vi.advanceTimersByTime(30 * 60_000);
    expect(policy.canStartSession("chat", "observe")).toEqual({ allowed: true });
    vi.advanceTimersByTime(29 * 60_000);

    expect(policy.canStartSession("chat", "observe")).toEqual({
      allowed: false,
      reason: "Session rate limit exceeded: 2 per hour",
    });
  });
});
