import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';
import { remix } from '../../../remix/index.js';
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

      const files = result.workspace.files;
      const entryFile = chooseWorkspaceEntryFile(Object.keys(files));

      await this.supabase
        .from('assessments')
        .update({
          workspace_files: files,
          workspace_entry_file: entryFile,
          workspace_generated_at: new Date().toISOString(),
          skeleton_id: skeletonId,
          generation_status: 'completed',
          generation_completed_at: new Date().toISOString(),
          generation_error: null,
        })
        .eq('id', assessmentId);

      this.logger.info(`[generation-queue] Completed assessment ${assessmentId} (skeleton: ${skeletonId})`);
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
