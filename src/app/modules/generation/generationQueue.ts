import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';
import { remix } from '../../../remix/index.js';
import type { AdaptPassMetrics, RemixResult } from '../../../remix/index.js';
import { chooseWorkspaceEntryFile } from '../assessments/assessmentWorkspace.js';

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

export type GenerationMetrics = {
  skeleton_id: string;
  primary: GenerationMetricsPass;
  repair: GenerationMetricsPass | null;
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
  return {
    skeleton_id: skeletonId,
    primary: passMetrics(primary),
    repair: repair ? passMetrics(repair) : null,
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

export class GenerationQueue {
  private supabase: SupabaseClient;
  private logger: FastifyBaseLogger;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private currentJob: Promise<void> | null = null;

  constructor(supabase: SupabaseClient, logger: FastifyBaseLogger) {
    this.supabase = supabase;
    this.logger = logger;
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
      .select('id, title, summary, instructions_md, source_brief, skeleton_id, authoring_config')
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

    try {
      const sourceBrief = (row.source_brief as string) ?? '';
      const skeletonId = (row.skeleton_id as string) || chooseSkeleton(sourceBrief);

      // Build a job brief from available assessment fields
      const title = (row.title as string) ?? '';
      const summary = (row.summary as string) ?? '';
      const instructions = (row.instructions_md as string) ?? '';
      const jobBrief = [title, summary, sourceBrief, instructions]
        .filter(Boolean)
        .join('\n\n');

      if (!jobBrief.trim()) {
        throw new Error('Assessment has no content to generate from (title, summary, source_brief, and instructions are all empty)');
      }

      const result = await remix({
        skeletonId,
        jobBrief,
      });

      const metrics = buildGenerationMetrics(skeletonId, result);
      const completedAt = new Date().toISOString();

      if (result.validation.overallPass) {
        const files = result.workspace.files;
        const entryFile = chooseWorkspaceEntryFile(Object.keys(files));

        await this.supabase
          .from('assessments')
          .update({
            workspace_files: files,
            workspace_entry_file: entryFile,
            workspace_generated_at: completedAt,
            skeleton_id: skeletonId,
            generation_status: 'completed',
            generation_completed_at: completedAt,
            generation_error: null,
            generation_metrics: metrics,
          })
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
