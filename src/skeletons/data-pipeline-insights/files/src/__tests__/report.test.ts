import { describe, expect, it } from "vitest";
import { sampleEvents } from "../data.js";
import { buildPipelineReport, renderPipelineReport } from "../report.js";

describe("pipeline report", () => {
  it("combines batch and stream insights into one report", async () => {
    const report = await buildPipelineReport(sampleEvents);

    expect(report.batch.totals.totalEvents).toBe(8);
    expect(report.windows).toHaveLength(3);
    expect(report.headline).toContain("8 events across 3 pipelines");
    expect(report.headline).toContain("2 late events");
  });

  it("renders a deterministic CLI-friendly report", async () => {
    const report = await buildPipelineReport(sampleEvents);
    const output = renderPipelineReport(report);

    expect(output).toContain("Pipeline Insights Console");
    expect(output).toContain("Batch summary");
    expect(output).toContain("Stream windows");
    expect(output).toContain("inventory: 3 events");
  });
});
