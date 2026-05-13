import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { authenticate } from '../../infra/auth/auth.js';
import { getSupabaseAdmin } from '../../infra/db/supabase.js';
import { getCompanyMembership, type CompanyMembership } from '../../infra/auth/companyAuth.js';
import { AssessmentRunner } from './assessmentRunner.js';
import { GradingService } from './gradingService.js';
import type { GradingQueue } from './gradingQueue.js';
import type { SandboxService } from '../../external/vercelSandbox/sandbox.js';

interface GradingRoutesOpts extends FastifyPluginOptions {
  gradingQueue: GradingQueue;
  sandboxService: SandboxService;
}

async function getCompanyOwnedSession(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  sessionId: string,
  membership: CompanyMembership,
) {
  const { data: session } = await supabase
    .from('sessions')
    .select('id, assignment_id')
    .eq('id', sessionId)
    .maybeSingle();

  if (!session) {
    return { status: 404 as const, error: 'Session not found' };
  }

  const assignmentId = session.assignment_id as string | null;
  if (!assignmentId) {
    return { status: 403 as const, error: 'Not authorized for this session' };
  }

  const { data: assignment } = await supabase
    .from('assessment_assignments')
    .select('id')
    .eq('id', assignmentId)
    .eq('company_id', membership.companyId)
    .maybeSingle();

  if (!assignment) {
    return { status: 403 as const, error: 'Not authorized for this session' };
  }

  return { status: 200 as const, session };
}

export async function gradingRoutes(
  fastify: FastifyInstance,
  opts: GradingRoutesOpts,
): Promise<void> {
  const { gradingQueue, sandboxService } = opts;

  fastify.addHook('preHandler', authenticate);

  /**
   * GET /api/sessions/:sessionId/grade
   * Returns one of:
   *  - 200 { ...grade }              when a grade row exists
   *  - 202 { status, stage }         when a job is pending / running
   *  - 404 { error }                 when neither exists
   *  - 500 { error, status: 'failed' } when terminal failure on the job
   */
  fastify.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/grade',
    async (request, reply) => {
      const membership = await getCompanyMembership(request.user.id);
      if (!membership) {
        return reply.status(403).send({ error: 'Company access required' });
      }

      const supabase = getSupabaseAdmin();
      const ownedSession = await getCompanyOwnedSession(supabase, request.params.sessionId, membership);
      if (ownedSession.status !== 200) {
        return reply.status(ownedSession.status).send({ error: ownedSession.error });
      }

      const runner = new AssessmentRunner({ supabase, sandboxService, logger: fastify.log });
      const gradingService = new GradingService({ supabase, logger: fastify.log, runner });

      try {
        const grade = await gradingService.getGrade(request.params.sessionId);
        if (grade) return grade;

        const job = await gradingQueue.getJobStatus(request.params.sessionId);
        if (!job) {
          return reply.status(404).send({ error: 'No grade found for this session' });
        }
        if (job.status === 'failed') {
          return reply.status(500).send({ status: 'failed', error: job.error ?? 'Grading failed' });
        }
        return reply.status(202).send({ status: job.status, stage: job.stage });
      } catch (err) {
        fastify.log.error({ err }, 'Failed to fetch grade');
        return reply.status(500).send({ error: 'Failed to fetch grade' });
      }
    },
  );

  /**
   * POST /api/sessions/:sessionId/grade
   * Idempotent. Returns cached grade if one exists, otherwise enqueues and returns 202.
   *
   * Query params:
   *   force=true        — delete the existing grade row and re-enqueue. The
   *                       cached runner_run is still reused unless force_runner=true.
   *   force_runner=true — implies force; also invalidates the cached runner result.
   */
  fastify.post<{
    Params: { sessionId: string };
    Querystring: { force?: string; force_runner?: string };
  }>(
    '/api/sessions/:sessionId/grade',
    async (request, reply) => {
      const membership = await getCompanyMembership(request.user.id);
      if (!membership) {
        return reply.status(403).send({ error: 'Company access required' });
      }

      const supabase = getSupabaseAdmin();
      const ownedSession = await getCompanyOwnedSession(supabase, request.params.sessionId, membership);
      if (ownedSession.status !== 200) {
        return reply.status(ownedSession.status).send({ error: ownedSession.error });
      }

      // Require submission to exist before enqueueing
      const { data: submission } = await supabase
        .from('final_submissions')
        .select('session_id')
        .eq('session_id', request.params.sessionId)
        .maybeSingle();
      if (!submission) {
        return reply.status(422).send({ error: 'No submission found for this session — cannot grade' });
      }

      const sessionId = request.params.sessionId;
      const forceRunner = request.query.force_runner === 'true';
      const force = forceRunner || request.query.force === 'true';

      const runner = new AssessmentRunner({ supabase, sandboxService, logger: fastify.log });
      const gradingService = new GradingService({ supabase, logger: fastify.log, runner });

      try {
        if (force) {
          // Drop the existing grade so the worker re-runs the pipeline.
          await supabase.from('candidate_grades').delete().eq('session_id', sessionId);
          if (forceRunner) {
            await supabase.from('grading_runner_runs').delete().eq('session_id', sessionId);
          }
        }

        const existing = await gradingService.getGrade(sessionId);
        if (existing) return reply.status(200).send(existing);

        await gradingQueue.enqueue(sessionId);
        const job = await gradingQueue.getJobStatus(sessionId);
        return reply.status(202).send({ status: job?.status ?? 'pending', stage: job?.stage ?? null });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to enqueue grading';
        fastify.log.error({ err }, 'Grading enqueue failed');
        return reply.status(500).send({ error: message });
      }
    },
  );
}
