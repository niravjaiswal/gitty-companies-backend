import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';
import type { SandboxService } from '../../external/vercelSandbox/sandbox.js';
import { AssessmentRunner } from './assessmentRunner.js';
import { GradingService } from './gradingService.js';

const POLL_INTERVAL_MS = 5_000;
/** Sandbox runs can take 2-3 minutes; allow generous stale recovery. */
const STALE_THRESHOLD_MS = 20 * 60 * 1_000;
const MAX_ATTEMPTS = 3;

type JobStage = 'runner' | 'llm' | 'finalize';

interface ClaimedJob {
  id: string;
  session_id: string;
  attempts: number;
}

/**
 * Background worker that polls `grading_jobs` and runs the full grading
 * pipeline (runner → optional LLM → composite + persist).
 *
 * Mirrors the GenerationQueue pattern: in-process polling with atomic
 * status-flip claim, stale recovery, and graceful shutdown.
 */
export class GradingQueue {
  private supabase: SupabaseClient;
  private sandboxService: SandboxService;
  private logger: FastifyBaseLogger;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private currentJob: Promise<void> | null = null;

  constructor(
    supabase: SupabaseClient,
    sandboxService: SandboxService,
    logger: FastifyBaseLogger,
  ) {
    this.supabase = supabase;
    this.sandboxService = sandboxService;
    this.logger = logger;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.info('[grading-queue] Started');
    this.scheduleNext();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.currentJob) {
      this.logger.info('[grading-queue] Waiting for in-flight job to finish…');
      await this.currentJob;
    }
    this.logger.info('[grading-queue] Stopped');
  }

  /**
   * Inserts a pending grade job for a session. Idempotent.
   * On conflict, resets attempts/stage/timestamps so a previously-exhausted
   * job becomes runnable again (e.g. when the recruiter triggers a re-grade).
   */
  async enqueue(sessionId: string): Promise<void> {
    const { error } = await this.supabase
      .from('grading_jobs')
      .upsert(
        {
          session_id: sessionId,
          status: 'pending',
          stage: null,
          attempts: 0,
          started_at: null,
          completed_at: null,
          error: null,
        },
        { onConflict: 'session_id' },
      );

    if (error) {
      this.logger.error({ error, sessionId }, '[grading-queue] Failed to enqueue grade job');
      throw error;
    }
    this.logger.info(`[grading-queue] Enqueued grade job for session ${sessionId}`);
  }

  /** Returns the current job state for a session, or null if no job exists. */
  async getJobStatus(sessionId: string): Promise<{
    status: 'pending' | 'running' | 'completed' | 'failed';
    stage: JobStage | null;
    error: string | null;
    attempts: number;
  } | null> {
    const { data } = await this.supabase
      .from('grading_jobs')
      .select('status, stage, error, attempts')
      .eq('session_id', sessionId)
      .maybeSingle();
    return (data as {
      status: 'pending' | 'running' | 'completed' | 'failed';
      stage: JobStage | null;
      error: string | null;
      attempts: number;
    } | null) ?? null;
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.currentJob = this.pollOnce()
        .catch((err) => {
          this.logger.error({ err }, '[grading-queue] Poll loop error');
        })
        .finally(() => {
          this.currentJob = null;
          this.scheduleNext();
        });
    }, POLL_INTERVAL_MS);
  }

  private async pollOnce(): Promise<void> {
    await this.recoverStaleJobs();

    const { data: pending, error: findError } = await this.supabase
      .from('grading_jobs')
      .select('id, session_id, attempts')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (findError) {
      this.logger.error({ error: findError }, '[grading-queue] Failed to query pending jobs');
      return;
    }
    if (!pending) return;

    // Atomic claim: bump status only if still pending.
    const { data: claimed, error: claimError } = await this.supabase
      .from('grading_jobs')
      .update({
        status: 'running',
        stage: 'runner',
        started_at: new Date().toISOString(),
        attempts: (pending.attempts as number) + 1,
        error: null,
      })
      .eq('id', pending.id)
      .eq('status', 'pending')
      .select('id, session_id, attempts')
      .maybeSingle();

    if (claimError || !claimed) return;

    await this.processJob(claimed as ClaimedJob);
  }

  private async processJob(job: ClaimedJob): Promise<void> {
    const sessionId = job.session_id;
    this.logger.info(`[grading-queue] Processing job ${job.id} (session ${sessionId}, attempt ${job.attempts})`);

    try {
      const runner = new AssessmentRunner({
        supabase: this.supabase,
        sandboxService: this.sandboxService,
        logger: this.logger,
      });
      const grading = new GradingService({
        supabase: this.supabase,
        logger: this.logger,
        runner,
      });

      await grading.gradeSession(sessionId, {
        onStage: async (stage) => {
          await this.supabase
            .from('grading_jobs')
            .update({ stage })
            .eq('id', job.id);
        },
      });

      await this.supabase
        .from('grading_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          stage: null,
          error: null,
        })
        .eq('id', job.id);

      this.logger.info(`[grading-queue] Completed job ${job.id} (session ${sessionId})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const giveUp = job.attempts >= MAX_ATTEMPTS;

      this.logger.error(
        { err, jobId: job.id, sessionId, attempts: job.attempts, giveUp },
        '[grading-queue] Job failed',
      );

      await this.supabase
        .from('grading_jobs')
        .update({
          status: giveUp ? 'failed' : 'pending',
          stage: null,
          error: message.slice(0, 2000),
          completed_at: giveUp ? new Date().toISOString() : null,
        })
        .eq('id', job.id);
    }
  }

  private async recoverStaleJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();

    const { data, error } = await this.supabase
      .from('grading_jobs')
      .update({
        status: 'pending',
        stage: null,
        started_at: null,
        error: 'recovered from stale running state',
      })
      .eq('status', 'running')
      .lt('started_at', cutoff)
      .select('id');

    if (error) {
      this.logger.error({ error }, '[grading-queue] Failed to recover stale jobs');
      return;
    }

    if (data && data.length > 0) {
      this.logger.warn(
        `[grading-queue] Recovered ${data.length} stale job(s): ${data.map((r) => r.id).join(', ')}`,
      );
    }
  }
}
