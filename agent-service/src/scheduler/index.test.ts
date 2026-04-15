import { describe, expect, it, vi } from "vitest";
import { RunScheduler } from "./index.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("RunScheduler", () => {
  it("queues runs until start is called", () => {
    const executor = vi.fn(async () => {});
    const scheduler = new RunScheduler({ executor });

    const runId = scheduler.schedule({
      sessionId: "session-1",
      capabilityId: "chat.basic",
      input: { message: "hello" },
    });

    expect(scheduler.getStatus(runId)).toEqual(
      expect.objectContaining({
        id: runId,
        sessionId: "session-1",
        capabilityId: "chat.basic",
        status: "pending",
      }),
    );
    expect(executor).not.toHaveBeenCalled();
  });

  it("executes queued runs after start", async () => {
    const executor = vi.fn(async () => {});
    const scheduler = new RunScheduler({ executor });
    const runId = scheduler.schedule({
      sessionId: "session-1",
      capabilityId: "parser-authoring",
      input: { topic: "a/b" },
    });

    scheduler.start();
    await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(1));

    expect(scheduler.getStatus(runId)).toEqual(
      expect.objectContaining({
        id: runId,
        status: "completed",
      }),
    );
  });

  it("enforces the maxConcurrent limit and starts queued work later", async () => {
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const gates = [first, second, third];
    const started: string[] = [];
    const executor = vi.fn(async (run) => {
      started.push(run.id);
      await gates.shift()?.promise;
    });
    const scheduler = new RunScheduler({
      maxConcurrent: 2,
      executor,
    });

    const runIds = [
      scheduler.schedule({ sessionId: "s1", capabilityId: "c1", input: 1 }),
      scheduler.schedule({ sessionId: "s1", capabilityId: "c2", input: 2 }),
      scheduler.schedule({ sessionId: "s1", capabilityId: "c3", input: 3 }),
    ];

    scheduler.start();
    await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(2));

    expect(started).toEqual(runIds.slice(0, 2));
    expect(scheduler.getStatus(runIds[2])).toEqual(
      expect.objectContaining({ status: "pending" }),
    );

    first.resolve();
    await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(3));
    expect(started).toEqual(runIds);

    second.resolve();
    third.resolve();
    await vi.waitFor(() =>
      expect(scheduler.getStatus(runIds[2])).toEqual(
        expect.objectContaining({ status: "completed" }),
      ),
    );
  });

  it("marks failed runs with the executor error", async () => {
    const scheduler = new RunScheduler({
      executor: async () => {
        throw new Error("boom");
      },
    });
    const runId = scheduler.schedule({
      sessionId: "session-2",
      capabilityId: "topic-diagnosis",
      input: { topic: "x/y" },
    });

    scheduler.start();
    await vi.waitFor(() =>
      expect(scheduler.getStatus(runId)).toEqual(
        expect.objectContaining({
          status: "failed",
          error: "boom",
        }),
      ),
    );
  });

  it("lists runs by session in reverse creation order", () => {
    const scheduler = new RunScheduler();

    const first = scheduler.schedule({
      id: "run-1",
      sessionId: "session-3",
      capabilityId: "cap-a",
      input: 1,
    });
    const second = scheduler.schedule({
      id: "run-2",
      sessionId: "session-3",
      capabilityId: "cap-b",
      input: 2,
    });
    scheduler.schedule({
      id: "run-3",
      sessionId: "session-4",
      capabilityId: "cap-c",
      input: 3,
    });

    expect(first).toBe("run-1");
    expect(second).toBe("run-2");
    expect(scheduler.listBySession("session-3").map((run) => run.id)).toEqual([
      "run-2",
      "run-1",
    ]);
  });
});
