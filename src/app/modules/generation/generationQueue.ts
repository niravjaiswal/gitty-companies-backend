import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';
import { remix } from '../../../remix/index.js';
import type { AdaptPassMetrics, RemixResult } from '../../../remix/index.js';
import { chooseWorkspaceEntryFile, normalizeAuthoringConfig } from '../assessments/assessmentWorkspace.js';
import {
  REPO_INGEST_ERROR_MESSAGES,
  RepoIngestError,
  ingestRepo as defaultIngestRepo,
  type IngestRepoInput,
  type RepoIngestResult,
} from '../assessments/repoIngestion.js';

const POLL_INTERVAL_MS = 5_000;
const STALE_THRESHOLD_MS = 10 * 60 * 1_000; // 10 minutes

const FRONTEND_KEYWORDS = [
  'frontend', 'front-end', 'react', 'vue', 'angular', 'svelte',
  'ui', 'ux', 'css', 'tailwind', 'next.js', 'nextjs', 'vite',
  'dashboard', 'component', 'design system',
];

const FULLSTACK_KEYWORDS = [
  'fullstack', 'full-stack', 'end-to-end', 'api + react', 'api and react',
  'frontend and backend', 'front-end and back-end', 'portal', 'customer support',
];

const DATA_KEYWORDS = [
  'data pipeline', 'pipeline', 'etl', 'stream', 'streaming', 'batch',
  'ingestion', 'transform', 'aggregation', 'analytics', 'warehouse',
  'events', 'metrics', 'data processing',
];

const CLI_KEYWORDS = [
  'cli', 'command line', 'terminal', 'shell', 'console', 'ops',
  'audit', 'log files', 'incident', 'developer tooling',
];

export type GenerationMetricsPass = {
  turns: number;
  cost_usd: number;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  verified: boolean;
};

export type GenerationVariationSelection = {
  axis_id: string;
  value: string | number | boolean;
  is_default: boolean;
  rationale: string;
};

export type GenerationVariationMetrics = {
  axes_count: number;
  non_default_count: number;
  planner_input_tokens: number;
  planner_output_tokens: number;
  executor: (GenerationMetricsPass & { sacred_violations: string[] }) | null;
  overall_rationale: string;
  selections: GenerationVariationSelection[];
  not_applicable: string[];
};

export type GenerationAdversarialMetrics = {
  verdict: string;
  rationale: string;
  solved_rate: number;
  median_turns: number;
  median_edits: number;
  avg_cost_usd: number;
  hardcoding_observed: boolean;
  test_files_modified: boolean;
  judgment_calls_observed: boolean;
  architectural_decisions_observed: boolean;
  num_runs: number;
};

export type GenerationMetrics = {
  skeleton_id: string;
  primary: GenerationMetricsPass;
  repair: GenerationMetricsPass | null;
  variation: GenerationVariationMetrics | null;
  adversarial: GenerationAdversarialMetrics | null;
  final_verified: boolean;
  tsc_output_head: string;
  vitest_output_head: string;
};

const METRICS_OUTPUT_HEAD_BYTES = 500;

function passMetrics(pass: AdaptPassMetrics): GenerationMetricsPass {
  return {
    turns: pass.turns,
    cost_usd: pass.totalCostUsd,
    duration_ms: pass.durationMs,
    input_tokens: pass.inputTokens,
    output_tokens: pass.outputTokens,
    verified: pass.verified,
  };
}

function extractOutputHead(errors: string[], prefix: string): string {
  const match = errors.find((e) => e.startsWith(`${prefix}:`));
  if (!match) return '';
  return match.slice(prefix.length + 1).trim().slice(0, METRICS_OUTPUT_HEAD_BYTES);
}

export function buildGenerationMetrics(skeletonId: string, result: RemixResult): GenerationMetrics {
  const { primary, repair } = result.usage.adapt;

  let variation: GenerationVariationMetrics | null = null;
  if (result.usage.vary && result.variationPlan) {
    const v = result.usage.vary;
    variation = {
      axes_count: v.planner.axesCount,
      non_default_count: v.planner.nonDefaultCount,
      planner_input_tokens: v.planner.inputTokens,
      planner_output_tokens: v.planner.outputTokens,
      executor: v.executor
        ? {
            turns: v.executor.turns,
            cost_usd: v.executor.totalCostUsd,
            duration_ms: v.executor.durationMs,
            input_tokens: v.executor.inputTokens,
            output_tokens: v.executor.outputTokens,
            verified: v.executor.verified,
            sacred_violations: v.executor.sacredViolations,
          }
        : null,
      overall_rationale: result.variationPlan.overallRationale,
      selections: result.variationPlan.selections.map((s) => ({
        axis_id: s.axisId,
        value: s.value,
        is_default: s.isDefault,
        rationale: s.rationale,
      })),
      not_applicable: result.variationPlan.notApplicable,
    };
  }

  let adversarial: GenerationAdversarialMetrics | null = null;
  if (result.adversarial) {
    const a = result.adversarial;
    adversarial = {
      verdict: a.qualityVerdict,
      rationale: a.verdictRationale,
      solved_rate: a.aggregate.solvedRate,
      median_turns: a.aggregate.medianTurns,
      median_edits: a.aggregate.medianEdits,
      avg_cost_usd: a.aggregate.avgCostUsd,
      hardcoding_observed: a.aggregate.hardcodingObserved,
      test_files_modified: a.aggregate.testFilesModified,
      judgment_calls_observed: a.aggregate.judgmentCallsObserved,
      architectural_decisions_observed: a.aggregate.architecturalDecisionsObserved,
      num_runs: a.numRuns,
    };
  }

  return {
    skeleton_id: skeletonId,
    primary: passMetrics(primary),
    repair: repair ? passMetrics(repair) : null,
    variation,
    adversarial,
    final_verified: result.validation.overallPass,
    tsc_output_head: extractOutputHead(result.validation.errors, 'tsc'),
    vitest_output_head: extractOutputHead(result.validation.errors, 'vitest'),
  };
}

export function chooseSkeleton(sourceBrief: string): string {
  const lower = sourceBrief.toLowerCase();
  if (FULLSTACK_KEYWORDS.some((kw) => lower.includes(kw))) {
    return 'fullstack-support-hub';
  }
  if (DATA_KEYWORDS.some((kw) => lower.includes(kw))) {
    return 'data-pipeline-insights';
  }
  if (CLI_KEYWORDS.some((kw) => lower.includes(kw))) {
    return 'ops-cli-audit';
  }
  if (FRONTEND_KEYWORDS.some((kw) => lower.includes(kw))) {
    return 'react-orders-board';
  }
  return 'rest-api-express';
}

export interface GenerationQueueDependencies {
  ingestRepo?: (input: IngestRepoInput) => Promise<RepoIngestResult>;
}

export class GenerationQueue {
  private supabase: SupabaseClient;
  private logger: FastifyBaseLogger;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private currentJob: Promise<void> | null = null;
  private ingestRepoFn: (input: IngestRepoInput) => Promise<RepoIngestResult>;

  constructor(
    supabase: SupabaseClient,
    logger: FastifyBaseLogger,
    deps: GenerationQueueDependencies = {},
  ) {
    this.supabase = supabase;
    this.logger = logger;
    this.ingestRepoFn = deps.ingestRepo ?? defaultIngestRepo;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.info('[generation-queue] Started');
    this.scheduleNext();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.currentJob) {
      this.logger.info('[generation-queue] Waiting for in-flight job to finish...');
      await this.currentJob;
    }
    this.logger.info('[generation-queue] Stopped');
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.currentJob = this.pollOnce()
        .catch((err) => {
          this.logger.error({ err }, '[generation-queue] Poll loop error');
        })
        .finally(() => {
          this.currentJob = null;
          this.scheduleNext();
        });
    }, POLL_INTERVAL_MS);
  }

  private async pollOnce(): Promise<void> {
    await this.recoverStaleJobs();

    // Find oldest pending job
    const { data: pending, error: findError } = await this.supabase
      .from('assessments')
      .select('id')
      .eq('generation_status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (findError) {
      this.logger.error({ error: findError }, '[generation-queue] Failed to query pending jobs');
      return;
    }

    if (!pending) return;

    // Atomic claim: only update if still pending
    const { data: claimed, error: claimError } = await this.supabase
      .from('assessments')
      .update({
        generation_status: 'processing',
        generation_started_at: new Date().toISOString(),
        generation_error: null,
      })
      .eq('id', pending.id)
      .eq('generation_status', 'pending')
      .select(
        'id, title, summary, instructions_md, source_brief, skeleton_id, authoring_config, source_type, source_repo_url, source_repo_ref',
      )
      .maybeSingle();

    if (claimError || !claimed) {
      // Another instance claimed it, or it was cancelled
      return;
    }

    this.logger.info(`[generation-queue] Processing assessment ${claimed.id}`);
    await this.processJob(claimed);
  }

  private async processJob(row: Record<string, unknown>): Promise<void> {
    const assessmentId = row.id as string;
    const sourceType = (row.source_type as string) || 'skeleton';

    if (sourceType === 'repo') {
      await this.processRepoJob(assessmentId, row);
      return;
    }

    try {
      const sourceBrief = (row.source_brief as string) ?? '';
      const skeletonId = (row.skeleton_id as string) || chooseSkeleton(sourceBrief);
      const authoringConfig = normalizeAuthoringConfig(row.authoring_config);

      // Build a job brief from available assessment fields.
      // Intentionally exclude instructions_md: once this queue writes a structured
      // brief back into that column, re-including it on regeneration would feed
      // the prior generated brief into the next jobBrief (feedback loop).
      // source_brief holds the raw recruiter prompt, so nothing is lost.
      const title = (row.title as string) ?? '';
      const summary = (row.summary as string) ?? '';
      const jobBrief = [title, summary, sourceBrief]
        .filter(Boolean)
        .join('\n\n');

      if (!jobBrief.trim()) {
        throw new Error('Assessment has no content to generate from (title, summary, and source_brief are all empty)');
      }

      const result = await remix({
        skeletonId,
        jobBrief,
        partCount: authoringConfig.partCount ?? 1,
        examSpecifics: authoringConfig.examSpecifics,
      });

      const metrics = buildGenerationMetrics(skeletonId, result);
      const completedAt = new Date().toISOString();

      if (result.validation.overallPass) {
        const files = result.workspace.files;
        const entryFile = chooseWorkspaceEntryFile(Object.keys(files));
        const updates: Record<string, unknown> = {
          workspace_files: files,
          workspace_entry_file: entryFile,
          workspace_generated_at: completedAt,
          skeleton_id: skeletonId,
          generation_status: 'completed',
          generation_completed_at: completedAt,
          generation_error: null,
          generation_metrics: metrics,
        };
        if (result.instructionsMd && result.instructionsMd.trim()) {
          updates.instructions_md = result.instructionsMd;
        }

        await this.supabase
          .from('assessments')
          .update(updates)
          .eq('id', assessmentId);

        this.logger.info(
          `[generation-queue] Completed assessment ${assessmentId} (skeleton: ${skeletonId}, repair=${metrics.repair !== null})`,
        );
      } else {
        const errorText = result.validation.errors.join('\n\n').slice(0, 2000)
          || 'Generation finished but failed validation (no error output captured).';

        await this.supabase
          .from('assessments')
          .update({
            skeleton_id: skeletonId,
            generation_status: 'failed',
            generation_completed_at: completedAt,
            generation_error: errorText,
            generation_metrics: metrics,
          })
          .eq('id', assessmentId);

        this.logger.warn(
          `[generation-queue] Assessment ${assessmentId} failed validation after ${metrics.repair ? 'repair' : 'primary'} pass (skeleton: ${skeletonId})`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err }, `[generation-queue] Failed assessment ${assessmentId}`);

      await this.supabase
        .from('assessments')
        .update({
          generation_status: 'failed',
          generation_error: message.slice(0, 2000),
          generation_completed_at: new Date().toISOString(),
        })
        .eq('id', assessmentId);
    }
  }

  private async processRepoJob(
    assessmentId: string,
    row: Record<string, unknown>,
  ): Promise<void> {
    const url = ((row.source_repo_url as string) ?? '').trim();
    const refRaw = (row.source_repo_ref as string | null | undefined) ?? undefined;
    const ref = typeof refRaw === 'string' && refRaw.trim().length > 0 ? refRaw.trim() : undefined;

    if (!url) {
      const completedAt = new Date().toISOString();
      await this.supabase
        .from('assessments')
        .update({
          generation_status: 'failed',
          generation_completed_at: completedAt,
          generation_error: 'Repository URL is missing on this assessment.',
        })
        .eq('id', assessmentId);
      this.logger.warn(
        `[generation-queue] Repo job ${assessmentId} has no source_repo_url; marked failed`,
      );
      return;
    }

    try {
      const result = await this.ingestRepoFn({ url, ref });
      const completedAt = new Date().toISOString();

      await this.supabase
        .from('assessments')
        .update({
          workspace_files: result.files,
          workspace_entry_file: result.entryFilePath,
          workspace_generated_at: completedAt,
          source_repo_commit_sha: result.commitSha,
          source_repo_metadata: result.metadata,
          generation_status: 'completed',
          generation_completed_at: completedAt,
          generation_error: null,
          generation_metrics: null,
        })
        .eq('id', assessmentId);

      this.logger.info(
        `[generation-queue] Completed repo ingest for ${assessmentId} (commit ${result.commitSha}, files ${result.metadata.filesKept})`,
      );
    } catch (err) {
      const completedAt = new Date().toISOString();
      const message =
        err instanceof RepoIngestError
          ? REPO_INGEST_ERROR_MESSAGES[err.code]
          : err instanceof Error
          ? err.message
          : String(err);

      this.logger.warn(
        { err },
        `[generation-queue] Repo ingest failed for ${assessmentId}`,
      );

      await this.supabase
        .from('assessments')
        .update({
          generation_status: 'failed',
          generation_completed_at: completedAt,
          generation_error: message.slice(0, 2000),
          generation_metrics: null,
        })
        .eq('id', assessmentId);
    }
  }

  private async recoverStaleJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();

    const { data, error } = await this.supabase
      .from('assessments')
      .update({
        generation_status: 'pending',
        generation_started_at: null,
        generation_error: null,
      })
      .eq('generation_status', 'processing')
      .lt('generation_started_at', cutoff)
      .select('id');

    if (error) {
      this.logger.error({ error }, '[generation-queue] Failed to recover stale jobs');
      return;
    }

    if (data && data.length > 0) {
      this.logger.warn(
        `[generation-queue] Recovered ${data.length} stale job(s): ${data.map((r) => r.id).join(', ')}`,
      );
    }
  }
}
