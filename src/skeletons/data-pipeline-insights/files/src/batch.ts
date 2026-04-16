import type { BatchSummary, PipelineBreakdown, PipelineEvent, PipelineTotals } from "./types.js";

const LATE_THRESHOLD_MS = 10 * 60 * 1000;

function parseTime(value: string): number {
  return Date.parse(value);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function isLateEvent(event: PipelineEvent): boolean {
  return parseTime(event.ingestedAt) - parseTime(event.occurredAt) > LATE_THRESHOLD_MS;
}

export function summarizeBatch(events: PipelineEvent[]): BatchSummary {
  const byPipeline = new Map<string, PipelineBreakdown & { durations: number[] }>();
  const slowest = [...events].filter((event) => typeof event.durationMs === "number" && event.durationMs > 0);

  const totals: PipelineTotals = {
    totalEvents: events.length,
    batchEvents: 0,
    streamEvents: 0,
    failures: 0,
    lateEvents: 0,
    totalRecords: 0,
    averageDurationMs: 0,
  };

  const durations: number[] = [];

  for (const event of events) {
    totals.totalRecords += event.records;
    durations.push(event.durationMs ?? 0);

    if (event.source === "batch") totals.batchEvents += 1;
    if (event.source === "stream") totals.streamEvents += 1;
    if (event.kind === "ingest_failed") totals.failures += 1;
    if (isLateEvent(event)) totals.lateEvents += 1;

    const existing = byPipeline.get(event.pipeline) ?? {
      pipeline: event.pipeline,
      events: 0,
      failures: 0,
      lateEvents: 0,
      totalRecords: 0,
      averageDurationMs: 0,
      durations: [],
    };

    existing.events += 1;
    existing.totalRecords += event.records;
    if (event.kind === "ingest_failed") existing.failures += 1;
    if (isLateEvent(event)) existing.lateEvents += 1;
    if (typeof event.durationMs === "number") existing.durations.push(event.durationMs);

    byPipeline.set(event.pipeline, existing);
  }

  totals.averageDurationMs = average(durations.filter((duration) => duration > 0));

  const breakdown = [...byPipeline.values()]
    .map(({ durations: pipelineDurations, ...entry }) => ({
      ...entry,
      averageDurationMs: average(pipelineDurations),
    }))
    .sort((left, right) => left.pipeline.localeCompare(right.pipeline));

  const slowestEvents = [...slowest]
    .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
    .slice(0, 3);

  return {
    generatedAt: "2025-04-15T10:00:00.000Z",
    totals,
    byPipeline: breakdown,
    slowestEvents,
  };
}
