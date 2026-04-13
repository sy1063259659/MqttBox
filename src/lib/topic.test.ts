import { describe, expect, it } from "vitest";

import { matchesTopicFilter } from "@/lib/topic";

describe("matchesTopicFilter", () => {
  it("matches exact topics", () => {
    expect(matchesTopicFilter("devices/alpha/status", "devices/alpha/status")).toBe(true);
    expect(matchesTopicFilter("devices/alpha/status", "devices/beta/status")).toBe(false);
  });

  it("supports single-level wildcard", () => {
    expect(matchesTopicFilter("devices/+/status", "devices/alpha/status")).toBe(true);
    expect(matchesTopicFilter("devices/+/status", "devices/alpha/meta")).toBe(false);
  });

  it("supports multi-level wildcard", () => {
    expect(matchesTopicFilter("devices/#", "devices/alpha/status")).toBe(true);
    expect(matchesTopicFilter("devices/#", "devices")).toBe(true);
    expect(matchesTopicFilter("devices/#", "sensors/alpha")).toBe(false);
  });
});
