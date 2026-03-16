import { describe, it, expect } from "vitest";
import { withConcurrencyLimit } from "../concurrency.js";

/**
 * Helper: creates a task that resolves after `ms` milliseconds with the given value.
 * Optionally tracks its running state via the provided `running` set so tests
 * can assert the concurrency invariant.
 */
function delayedTask<T>(
  value: T,
  ms: number,
  running?: { current: number; peak: number },
): () => Promise<T> {
  return () =>
    new Promise<T>((resolve) => {
      if (running) {
        running.current++;
        if (running.current > running.peak) {
          running.peak = running.current;
        }
      }
      setTimeout(() => {
        if (running) {
          running.current--;
        }
        resolve(value);
      }, ms);
    });
}

/**
 * Helper: creates a task that rejects after `ms` milliseconds with the given reason.
 */
function failingTask(reason: string, ms: number): () => Promise<never> {
  return () =>
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(reason)), ms);
    });
}

describe("withConcurrencyLimit", () => {
  it("runs all tasks and returns results in order", async () => {
    const tasks = [
      delayedTask("a", 30),
      delayedTask("b", 10),
      delayedTask("c", 20),
    ];

    const results = await withConcurrencyLimit(tasks, 3);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ status: "fulfilled", value: "a" });
    expect(results[1]).toEqual({ status: "fulfilled", value: "b" });
    expect(results[2]).toEqual({ status: "fulfilled", value: "c" });
  });

  it("respects concurrency limit (at most N tasks run simultaneously)", async () => {
    const running = { current: 0, peak: 0 };
    const limit = 2;

    const tasks = Array.from({ length: 6 }, (_, i) =>
      delayedTask(i, 20, running),
    );

    const results = await withConcurrencyLimit(tasks, limit);

    // The peak number of concurrently running tasks must never exceed the limit.
    expect(running.peak).toBeLessThanOrEqual(limit);
    // All six tasks should have completed.
    expect(results).toHaveLength(6);
    results.forEach((r, i) => {
      expect(r).toEqual({ status: "fulfilled", value: i });
    });
  });

  it("handles an empty task array", async () => {
    const results = await withConcurrencyLimit([], 5);

    expect(results).toEqual([]);
  });

  it("does not cancel remaining tasks when one fails (allSettled semantics)", async () => {
    const tasks = [
      delayedTask("first", 10),
      failingTask("boom", 10),
      delayedTask("third", 10),
    ];

    const results = await withConcurrencyLimit(tasks, 3);

    expect(results).toHaveLength(3);

    // The fulfilled tasks must still have their values.
    expect(results[0]).toEqual({ status: "fulfilled", value: "first" });
    expect(results[2]).toEqual({ status: "fulfilled", value: "third" });

    // The failed task must be recorded as rejected.
    expect(results[1].status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect((results[1] as PromiseRejectedResult).reason.message).toBe("boom");
  });

  it("handles mixed fulfilled and rejected results", async () => {
    const tasks: Array<() => Promise<string>> = [
      delayedTask("ok-0", 5),
      failingTask("err-1", 5),
      delayedTask("ok-2", 5),
      failingTask("err-3", 5),
      delayedTask("ok-4", 5),
    ];

    const results = await withConcurrencyLimit(tasks, 2);

    expect(results).toHaveLength(5);

    // Fulfilled slots
    expect(results[0]).toEqual({ status: "fulfilled", value: "ok-0" });
    expect(results[2]).toEqual({ status: "fulfilled", value: "ok-2" });
    expect(results[4]).toEqual({ status: "fulfilled", value: "ok-4" });

    // Rejected slots
    expect(results[1].status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason.message).toBe("err-1");
    expect(results[3].status).toBe("rejected");
    expect((results[3] as PromiseRejectedResult).reason.message).toBe("err-3");
  });

  it("works with a single task", async () => {
    const results = await withConcurrencyLimit(
      [delayedTask(42, 5)],
      1,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ status: "fulfilled", value: 42 });
  });

  it("works when the limit is greater than the number of tasks", async () => {
    const running = { current: 0, peak: 0 };
    const tasks = [
      delayedTask("x", 10, running),
      delayedTask("y", 10, running),
    ];

    const results = await withConcurrencyLimit(tasks, 100);

    // All tasks should still complete successfully.
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ status: "fulfilled", value: "x" });
    expect(results[1]).toEqual({ status: "fulfilled", value: "y" });

    // Peak concurrency should be capped at the actual number of tasks, not the limit.
    expect(running.peak).toBeLessThanOrEqual(2);
  });
});
