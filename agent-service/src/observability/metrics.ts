type MetricLabels = Record<string, string>;

interface CounterSnapshot {
  type: "counter";
  name: string;
  labels: MetricLabels;
  value: number;
}

interface HistogramStats {
  count: number;
  sum: number;
  avg: number;
  min: number | null;
  max: number | null;
}

interface HistogramSnapshot {
  type: "histogram";
  name: string;
  labels: MetricLabels;
  summary: HistogramStats;
}

export interface CounterMetric {
  inc(amount?: number): void;
  value(): number;
}

export interface HistogramMetric {
  observe(value: number): void;
  summary(): HistogramStats;
}

const DEFAULT_COUNTERS = ["sessions_created_total", "messages_processed_total"] as const;
const DEFAULT_HISTOGRAMS = ["message_processing_duration_ms"] as const;

function normalizeLabels(labels?: MetricLabels): MetricLabels {
  if (!labels) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(labels).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function metricKey(name: string, labels?: MetricLabels): string {
  return `${name}:${JSON.stringify(normalizeLabels(labels))}`;
}

class Counter implements CounterMetric {
  private total = 0;

  constructor(
    readonly name: string,
    readonly labels: MetricLabels,
  ) {}

  inc(amount = 1): void {
    this.total += amount;
  }

  value(): number {
    return this.total;
  }
}

class Histogram implements HistogramMetric {
  private countValue = 0;
  private sumValue = 0;
  private minValue: number | null = null;
  private maxValue: number | null = null;

  constructor(
    readonly name: string,
    readonly labels: MetricLabels,
  ) {}

  observe(value: number): void {
    this.countValue += 1;
    this.sumValue += value;
    this.minValue = this.minValue === null ? value : Math.min(this.minValue, value);
    this.maxValue = this.maxValue === null ? value : Math.max(this.maxValue, value);
  }

  summary(): HistogramStats {
    return {
      count: this.countValue,
      sum: this.sumValue,
      avg: this.countValue === 0 ? 0 : this.sumValue / this.countValue,
      min: this.minValue,
      max: this.maxValue,
    };
  }
}

export class MetricsRegistry {
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();

  constructor() {
    for (const name of DEFAULT_COUNTERS) {
      this.counter(name);
    }
    for (const name of DEFAULT_HISTOGRAMS) {
      this.histogram(name);
    }
  }

  counter(name: string, labels?: MetricLabels): CounterMetric {
    const normalizedLabels = normalizeLabels(labels);
    const key = metricKey(name, normalizedLabels);
    let counter = this.counters.get(key);
    if (!counter) {
      counter = new Counter(name, normalizedLabels);
      this.counters.set(key, counter);
    }
    return counter;
  }

  histogram(name: string, labels?: MetricLabels): HistogramMetric {
    const normalizedLabels = normalizeLabels(labels);
    const key = metricKey(name, normalizedLabels);
    let histogram = this.histograms.get(key);
    if (!histogram) {
      histogram = new Histogram(name, normalizedLabels);
      this.histograms.set(key, histogram);
    }
    return histogram;
  }

  snapshot(): {
    counters: CounterSnapshot[];
    histograms: HistogramSnapshot[];
  } {
    return {
      counters: [...this.counters.values()].map((counter) => ({
        type: "counter",
        name: counter.name,
        labels: counter.labels,
        value: counter.value(),
      })),
      histograms: [...this.histograms.values()].map((histogram) => ({
        type: "histogram",
        name: histogram.name,
        labels: histogram.labels,
        summary: histogram.summary(),
      })),
    };
  }
}
