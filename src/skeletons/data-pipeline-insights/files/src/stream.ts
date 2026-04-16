import { Transform } from "node:stream";
import type { PipelineEvent, WindowInsight, WindowSeverity } from "./types.js";

const LATE_THRESHOLD_MS = 10 * 60 * 1000;
const FAILURE_RED_THRESHOLD = 1;

function parseTime(value: string): number {
  return Date.parse(value);
}

function formatIsoWindowStart(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function windowBounds(timestamp: number, windowMinutes: number): { start: number; end: number } {
  const windowMs = windowMinutes * 60 * 1000;
  const start = Math.floor(timestamp / windowMs) * windowMs;
  return {
    start,
    end: start + windowMs - 1,
  };
}

function classifyWindow(insight: Omit<WindowInsight, "severity">): WindowSeverity {
  if (insight.failures >= FAILURE_RED_THRESHOLD) return "red";
  if (insight.lateEvents > 0 && insight.maxDurationMs >= 4000) return "amber";
  return "green";
}

function buildWindowInsight(events: PipelineEvent[], windowMinutes: number): WindowInsight {
  const first = events[0];
  const bounds = windowBounds(parseTime(first.occurredAt), windowMinutes);
  const totalRecords = events.reduce((sum, event) => sum + event.records, 0);
  const failures = events.filter((event) => event.kind === "ingest_failed").length;
  const lateEvents = events.filter(
    (event) => parseTime(event.ingestedAt) - parseTime(event.occurredAt) > LATE_THRESHOLD_MS,
  ).length;
  const maxDurationMs = events.reduce((max, event) => Math.max(max, event.durationMs ?? 0), 0);

  const insight = {
    windowStart: formatIsoWindowStart(bounds.start),
    windowEnd: formatIsoWindowStart(bounds.end),
    events: events.length,
    failures,
    lateEvents,
    totalRecords,
    maxDurationMs,
  };

  return {
    ...insight,
    severity: classifyWindow(insight),
  };
}

export function createWindowInsightStream(windowMinutes = 15): Transform {
  const windows = new Map<number, PipelineEvent[]>();

  return new Transform({
    objectMode: true,
    transform(event: PipelineEvent, _encoding, callback) {
      const timestamp = parseTime(event.occurredAt);
      const bounds = windowBounds(timestamp, windowMinutes);
      const current = windows.get(bounds.start) ?? [];
      current.push(event);
      windows.set(bounds.start, current);
      callback();
    },
    flush(callback) {
      for (const [start, events] of [...windows.entries()].sort((left, right) => left[0] - right[0])) {
        const ordered = [...events].sort((left, right) => parseTime(left.occurredAt) - parseTime(right.occurredAt));
        this.push(buildWindowInsight(ordered, windowMinutes));
      }
      callback();
    },
  });
}

export async function collectWindowInsights(
  events: PipelineEvent[],
  windowMinutes = 15,
): Promise<WindowInsight[]> {
  const stream = createWindowInsightStream(windowMinutes);
  const insights: WindowInsight[] = [];

  await new Promise<void>((resolve, reject) => {
    stream.on("data", (insight: WindowInsight) => {
      insights.push(insight);
    });
    stream.on("end", resolve);
    stream.on("error", reject);

    for (const event of events) {
      stream.write(event);
    }
    stream.end();
  });

  return insights;
}
