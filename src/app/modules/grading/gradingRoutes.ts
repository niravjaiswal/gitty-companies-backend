import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { authenticate } from '../../infra/auth/auth.js';
import { getSupabaseAdmin } from '../../infra/db/supabase.js';
import { getCompanyMembership } from '../../infra/auth/companyAuth.js';
import { GradingService } from './gradingService.js';

export async function gradingRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions,
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  /** GET /api/sessions/:sessionId/grade — fetch an existing grade */
  fastify.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/grade',
    async (request, reply) => {
      const membership = await getCompanyMembership(request.user.id);
      if (!membership) {
        return reply.status(403).send({ error: 'Company access required' });
      }

      const supabase = getSupabaseAdmin();

      // Verify the session belongs to a submission within this company
      const { data: session } = await supabase
        .from('sessions')
        .select('id, assignment_id')
        .eq('id', request.params.sessionId)
        .maybeSingle();

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const gradingService = new GradingService(supabase, fastify.log);

      try {
        const grade = await gradingService.getGrade(request.params.sessionId);
        if (!grade) {
          return reply.status(404).send({ error: 'No grade found for this session' });
        }
        return grade;
      } catch (err) {
        fastify.log.error({ err }, 'Failed to fetch grade');
        return reply.status(500).send({ error: 'Failed to fetch grade' });
      }
    },
  );

  /**
   * POST /api/sessions/:sessionId/grade — trigger (or retrieve) grading.
   * Idempotent: returns the cached grade if already graded.
   */
  fastify.post<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/grade',
    async (request, reply) => {
      const membership = await getCompanyMembership(request.user.id);
      if (!membership) {
        return reply.status(403).send({ error: 'Company access required' });
      }

      const supabase = getSupabaseAdmin();

      const { data: session } = await supabase
        .from('sessions')
        .select('id, assignment_id')
        .eq('id', request.params.sessionId)
        .maybeSingle();

      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const gradingService = new GradingService(supabase, fastify.log);

      try {
        const grade = await gradingService.gradeSession(request.params.sessionId);
        return reply.status(200).send(grade);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to grade session';
        fastify.log.error({ err }, 'Grading failed');

        if (message.includes('No submission found')) {
          return reply.status(422).send({ error: message });
        }

        return reply.status(500).send({ error: message });
      }
    },
  );
}
