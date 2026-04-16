import { describe, expect, it } from "vitest";
import { sampleEvents } from "../data.js";
import { summarizeBatch } from "../batch.js";

describe("summarizeBatch", () => {
  it("summarizes totals, lateness, and failures", () => {
    const summary = summarizeBatch(sampleEvents);

    expect(summary.totals.totalEvents).toBe(8);
    expect(summary.totals.batchEvents).toBe(4);
    expect(summary.totals.streamEvents).toBe(4);
    expect(summary.totals.failures).toBe(1);
    expect(summary.totals.lateEvents).toBe(2);
    expect(summary.totals.totalRecords).toBe(4150);
    expect(summary.totals.averageDurationMs).toBeGreaterThan(0);
  });

  it("groups pipeline-level statistics", () => {
    const summary = summarizeBatch(sampleEvents);

    expect(summary.byPipeline).toHaveLength(3);
    expect(summary.byPipeline[0].pipeline).toBe("customers");
    expect(summary.byPipeline.find((entry) => entry.pipeline === "inventory")?.failures).toBe(1);
    expect(summary.byPipeline.find((entry) => entry.pipeline === "orders")?.lateEvents).toBe(1);
  });

  it("keeps the slowest events sorted descending", () => {
    const summary = summarizeBatch(sampleEvents);

    expect(summary.slowestEvents[0]?.durationMs).toBeGreaterThanOrEqual(
      summary.slowestEvents[1]?.durationMs ?? 0,
    );
    expect(summary.slowestEvents[0]?.id).toBe("evt-004");
  });
});
