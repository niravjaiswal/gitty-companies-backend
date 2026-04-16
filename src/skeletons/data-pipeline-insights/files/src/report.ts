import type { PipelineEvent, PipelineReport } from "./types.js";
import { summarizeBatch } from "./batch.js";
import { collectWindowInsights } from "./stream.js";

export async function buildPipelineReport(
  events: PipelineEvent[],
  windowMinutes = 15,
): Promise<PipelineReport> {
  const batch = summarizeBatch(events);
  const windows = await collectWindowInsights(events, windowMinutes);
  const hottestWindow = windows.reduce(
    (winner, window) => {
      if (!winner) return window;
      if (window.severity === "red" && winner.severity !== "red") return window;
      if (window.severity === winner.severity && window.failures > winner.failures) return window;
      return winner;
    },
    windows[0] ?? null,
  );

  const headline = [
    `${batch.totals.totalEvents} events across ${batch.byPipeline.length} pipelines`,
    `${batch.totals.lateEvents} late events`,
    `${batch.totals.failures} failures`,
    hottestWindow ? `peak window ${hottestWindow.severity}` : "no windows",
  ].join(" • ");

  return {
    batch,
    windows,
    headline,
  };
}

export function renderPipelineReport(report: PipelineReport): string {
  const lines: string[] = [];
  lines.push("Pipeline Insights Console");
  lines.push(report.headline);
  lines.push("");
  lines.push("Batch summary");
  lines.push(`- total events: ${report.batch.totals.totalEvents}`);
  lines.push(`- batch events: ${report.batch.totals.batchEvents}`);
  lines.push(`- stream events: ${report.batch.totals.streamEvents}`);
  lines.push(`- failures: ${report.batch.totals.failures}`);
  lines.push(`- late events: ${report.batch.totals.lateEvents}`);
  lines.push(`- average duration: ${report.batch.totals.averageDurationMs}ms`);
  lines.push("");
  lines.push("Pipeline breakdown");

  for (const entry of report.batch.byPipeline) {
    lines.push(
      `- ${entry.pipeline}: ${entry.events} events, ${entry.failures} failures, ${entry.lateEvents} late, ${entry.totalRecords} records, ${entry.averageDurationMs}ms avg`,
    );
  }

  lines.push("");
  lines.push("Stream windows");
  for (const window of report.windows) {
    lines.push(
      `- ${window.windowStart} to ${window.windowEnd}: ${window.events} events, ${window.failures} failures, ${window.lateEvents} late, ${window.totalRecords} records, ${window.severity}`,
    );
  }

  return lines.join("\n");
}
