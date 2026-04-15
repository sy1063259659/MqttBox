import { describe, expect, it } from "vitest";
import { MetricsRegistry } from "./metrics.js";

describe("MetricsRegistry", () => {
  it("reuses counters with the same name and labels", () => {
    const metrics = new MetricsRegistry();
    const left = metrics.counter("messages_processed_total", {
      mode: "chat",
      scope: "agent",
    });
    const right = metrics.counter("messages_processed_total", {
      scope: "agent",
      mode: "chat",
    });

    left.inc();
    right.inc(2);

    expect(left.value()).toBe(3);
    expect(right.value()).toBe(3);
  });

  it("tracks histogram summary statistics", () => {
    const metrics = new MetricsRegistry();
    const histogram = metrics.histogram("message_processing_duration_ms", {
      mode: "chat",
    });

    histogram.observe(5);
    histogram.observe(15);
    histogram.observe(10);

    expect(histogram.summary()).toEqual({
      count: 3,
      sum: 30,
      avg: 10,
      min: 5,
      max: 15,
    });
  });

  it("returns predefined metrics in the registry snapshot", () => {
    const metrics = new MetricsRegistry();

    expect(metrics.snapshot()).toEqual({
      counters: expect.arrayContaining([
        {
          type: "counter",
          name: "sessions_created_total",
          labels: {},
          value: 0,
        },
        {
          type: "counter",
          name: "messages_processed_total",
          labels: {},
          value: 0,
        },
      ]),
      histograms: expect.arrayContaining([
        {
          type: "histogram",
          name: "message_processing_duration_ms",
          labels: {},
          summary: {
            count: 0,
            sum: 0,
            avg: 0,
            min: null,
            max: null,
          },
        },
      ]),
    });
  });
});
