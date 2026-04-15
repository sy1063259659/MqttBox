import { randomUUID } from "node:crypto";

export type ScheduledRunStatus = "pending" | "running" | "completed" | "failed";

export interface ScheduledRun {
  id: string;
  sessionId: string;
  capabilityId: string;
  input: unknown;
  status: ScheduledRunStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface ScheduleRunInput {
  sessionId: string;
  capabilityId: string;
  input: unknown;
  id?: string;
}

export interface RunSchedulerConfig {
  maxConcurrent?: number;
  executor?: (run: ScheduledRun) => Promise<void>;
}

const DEFAULT_MAX_CONCURRENT = 3;

export class RunScheduler {
  private readonly runs = new Map<string, ScheduledRun>();
  private readonly queue: string[] = [];
  private readonly maxConcurrent: number;
  private readonly executor: (run: ScheduledRun) => Promise<void>;
  private activeCount = 0;
  private running = false;

  constructor(config: RunSchedulerConfig = {}) {
    this.maxConcurrent = config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.executor = config.executor ?? (async () => {});
  }

  schedule(input: ScheduleRunInput): string {
    const runId = input.id ?? randomUUID();
    const run: ScheduledRun = {
      id: runId,
      sessionId: input.sessionId,
      capabilityId: input.capabilityId,
      input: input.input,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    this.runs.set(runId, run);
    this.queue.push(runId);
    this.pump();
    return runId;
  }

  getStatus(runId: string): ScheduledRun | null {
    return this.runs.get(runId) ?? null;
  }

  listBySession(sessionId: string): ScheduledRun[] {
    return Array.from(this.runs.values())
      .filter((run) => run.sessionId === sessionId)
      .reverse();
  }

  start(): void {
    this.running = true;
    this.pump();
  }

  stop(): void {
    this.running = false;
  }

  private pump(): void {
    if (!this.running) {
      return;
    }

    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const runId = this.queue.shift();
      if (!runId) {
        return;
      }

      const run = this.runs.get(runId);
      if (!run || run.status !== "pending") {
        continue;
      }

      this.activeCount += 1;
      run.status = "running";
      run.startedAt = new Date().toISOString();
      void this.execute(run);
    }
  }

  private async execute(run: ScheduledRun): Promise<void> {
    try {
      await this.executor({ ...run });
      run.status = "completed";
    } catch (error) {
      run.status = "failed";
      run.error = error instanceof Error ? error.message : String(error);
    } finally {
      run.completedAt = new Date().toISOString();
      this.activeCount -= 1;
      this.pump();
    }
  }
}
