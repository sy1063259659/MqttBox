import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "./logger.js";

describe("Logger", () => {
  const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));
    consoleSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits structured json logs", () => {
    const logger = new Logger("agent-service", "debug");

    logger.info("session created", {
      sessionId: "session-1",
      mode: "chat",
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      JSON.stringify({
        timestamp: "2026-04-15T00:00:00.000Z",
        level: "info",
        scope: "agent-service",
        message: "session created",
        sessionId: "session-1",
        mode: "chat",
      }),
    );
  });

  it("filters logs below the configured min level", () => {
    const logger = new Logger("agent-service", "warn");

    logger.debug("hidden debug");
    logger.info("hidden info");
    logger.warn("visible warn");

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(consoleSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      level: "warn",
      message: "visible warn",
    });
  });
});
