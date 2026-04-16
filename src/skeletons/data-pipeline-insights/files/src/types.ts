export type PipelineSource = "batch" | "stream";

export type PipelineKind =
  | "ingest_started"
  | "ingest_completed"
  | "ingest_failed"
  | "checkpoint"
  | "lag_warning";

export interface PipelineEvent {
  id: string;
  pipeline: string;
  source: PipelineSource;
  kind: PipelineKind;
  occurredAt: string;
  ingestedAt: string;
  records: number;
  durationMs?: number;
  note?: string;
}

export interface PipelineTotals {
  totalEvents: number;
  batchEvents: number;
  streamEvents: number;
  failures: number;
  lateEvents: number;
  totalRecords: number;
  averageDurationMs: number;
}

export interface PipelineBreakdown {
  pipeline: string;
  events: number;
  failures: number;
  lateEvents: number;
  totalRecords: number;
  averageDurationMs: number;
}

export interface BatchSummary {
  generatedAt: string;
  totals: PipelineTotals;
  byPipeline: PipelineBreakdown[];
  slowestEvents: PipelineEvent[];
}

export type WindowSeverity = "green" | "amber" | "red";

export interface WindowInsight {
  windowStart: string;
  windowEnd: string;
  events: number;
  failures: number;
  lateEvents: number;
  totalRecords: number;
  maxDurationMs: number;
  severity: WindowSeverity;
}

export interface PipelineReport {
  batch: BatchSummary;
  windows: WindowInsight[];
  headline: string;
}
