import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../db/supabase.js';
import { normalizeEmail } from '../utils/email.js';
import { getCompanyMembership } from '../utils/companyAuth.js';
import type { SessionManager } from '../services/sessionManager.js';

interface AssessmentRouteOptions extends FastifyPluginOptions {
  sessionManager: SessionManager;
}

async function claimAssignmentsForUser(userId: string, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('assessment_assignments')
    .select('id, status, candidate_user_id')
    .eq('candidate_email_normalized', normalized);

  if (!data || data.length === 0) return;

  const toClaim = data.filter((row) => !row.candidate_user_id);
  if (toClaim.length > 0) {
    await supabase
      .from('assessment_assignments')
      .update({
        candidate_user_id: userId,
        claimed_at: new Date().toISOString(),
        status: 'claimed',
      })
      .in('id', toClaim.map((row) => row.id));
  }

  const staleAssigned = data.filter(
    (row) => row.candidate_user_id === userId && row.status === 'assigned',
  );
  if (staleAssigned.length > 0) {
    await supabase
      .from('assessment_assignments')
      .update({
        status: 'claimed',
        claimed_at: new Date().toISOString(),
      })
      .in('id', staleAssigned.map((row) => row.id));
  }
}

export async function assessmentRoutes(
  fastify: FastifyInstance,
  opts: AssessmentRouteOptions,
): Promise<void> {
  const { sessionManager } = opts;
  fastify.addHook('preHandler', authenticate);

  fastify.get('/api/company/me', async (request, reply) => {
    const membership = await getCompanyMembership(request.user.id);
    if (!membership) {
      return reply.status(404).send({ error: 'Company membership not found' });
    }

    const supabase = getSupabaseAdmin();
    const { data: company, error } = await supabase
      .from('companies')
      .select('id, name, created_at')
      .eq('id', membership.companyId)
      .single();

    if (error || !company) {
      return reply.status(404).send({ error: 'Company not found' });
    }

    return {
      company: {
        id: company.id,
        name: company.name,
        createdAt: company.created_at,
      },
      membership,
    };
  });

  fastify.post<{
    Body: { name: string };
  }>(
    '/api/company/bootstrap',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 120 },
          },
        },
      },
    },
    async (request, reply) => {
      const existing = await getCompanyMembership(request.user.id);
      if (existing) {
        return reply.status(409).send({ error: 'User already belongs to a company' });
      }

      const supabase = getSupabaseAdmin();
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .insert({
          name: request.body.name.trim(),
          created_by: request.user.id,
        })
        .select()
        .single();

      if (companyError || !company) {
        return reply.status(500).send({ error: 'Failed to create company' });
      }

      const { error: memberError } = await supabase
        .from('company_members')
        .insert({
          company_id: company.id,
          user_id: request.user.id,
          role: 'owner',
        });

      if (memberError) {
        return reply.status(500).send({ error: 'Failed to create company membership' });
      }

      return reply.status(201).send({
        company: {
          id: company.id,
          name: company.name,
          createdAt: company.created_at,
        },
        membership: {
          companyId: company.id,
          role: 'owner',
        },
      });
    },
  );

  fastify.get('/api/company/assessments', async (request, reply) => {
    const membership = await getCompanyMembership(request.user.id);
    if (!membership) {
      return reply.status(403).send({ error: 'Company access required' });
    }

    const supabase = getSupabaseAdmin();
    const [{ data: assessments }, { data: assignments }] = await Promise.all([
      supabase
        .from('assessments')
        .select('*')
        .eq('company_id', membership.companyId)
        .order('created_at', { ascending: false }),
      supabase
        .from('assessment_assignments')
        .select('assessment_id, status')
        .eq('company_id', membership.companyId),
    ]);

    const countsByAssessment = new Map<string, { total: number; completed: number; inProgress: number }>();
    for (const assignment of assignments ?? []) {
      const assessmentId = assignment.assessment_id as string;
      const current = countsByAssessment.get(assessmentId) ?? { total: 0, completed: 0, inProgress: 0 };
      current.total += 1;
      if (assignment.status === 'completed') current.completed += 1;
      if (assignment.status === 'started') current.inProgress += 1;
      countsByAssessment.set(assessmentId, current);
    }

    return (assessments ?? []).map((assessment) => {
      const counts = countsByAssessment.get(assessment.id as string) ?? {
        total: 0,
        completed: 0,
        inProgress: 0,
      };

      return {
        id: assessment.id,
        title: assessment.title,
        summary: assessment.summary,
        instructionsMd: assessment.instructions_md,
        durationMinutes: assessment.duration_minutes,
        status: assessment.status,
        publishedAt: assessment.published_at,
        createdAt: assessment.created_at,
        updatedAt: assessment.updated_at,
        assignmentCount: counts.total,
        completedCount: counts.completed,
        inProgressCount: counts.inProgress,
      };
    });
  });

  fastify.post<{
    Body: {
      title: string;
      summary?: string;
      instructionsMd: string;
      durationMinutes: number;
      status?: 'draft' | 'published';
    };
  }>(
    '/api/company/assessments',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title', 'instructionsMd', 'durationMinutes'],
          properties: {
            title: { type: 'string', minLength: 3, maxLength: 160 },
            summary: { type: 'string', maxLength: 600 },
            instructionsMd: { type: 'string', minLength: 10 },
            durationMinutes: { type: 'integer', minimum: 15, maximum: 480 },
            status: { type: 'string', enum: ['draft', 'published'] },
          },
        },
      },
    },
    async (request, reply) => {
      const membership = await getCompanyMembership(request.user.id);
      if (!membership) {
        return reply.status(403).send({ error: 'Company access required' });
      }

      const status = request.body.status ?? 'draft';
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from('assessments')
        .insert({
          company_id: membership.companyId,
          created_by: request.user.id,
          title: request.body.title.trim(),
          summary: request.body.summary?.trim() ?? '',
          instructions_md: request.body.instructionsMd.trim(),
          duration_minutes: request.body.durationMinutes,
          status,
          published_at: status === 'published' ? new Date().toISOString() : null,
        })
        .select()
        .single();

      if (error || !data) {
        return reply.status(500).send({ error: 'Failed to create assessment' });
      }

      return reply.status(201).send({
        id: data.id,
        title: data.title,
        summary: data.summary,
        instructionsMd: data.instructions_md,
        durationMinutes: data.duration_minutes,
        status: data.status,
        publishedAt: data.published_at,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      });
    },
  );

  fastify.get<{
    Params: { assessmentId: string };
  }>(
    '/api/company/assessments/:assessmentId',
    async (request, reply) => {
      const membership = await getCompanyMembership(request.user.id);
      if (!membership) {
        return reply.status(403).send({ error: 'Company access required' });
      }

      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from('assessments')
        .select('*')
        .eq('id', request.params.assessmentId)
        .eq('company_id', membership.companyId)
        .single();

      if (error || !data) {
        return reply.status(404).send({ error: 'Assessment not found' });
      }

      return {
        id: data.id,
        title: data.title,
        summary: data.summary,
        instructionsMd: data.instructions_md,
        durationMinutes: data.duration_minutes,
        status: data.status,
        publishedAt: data.published_at,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },
  );

  fastify.patch<{
    Params: { assessmentId: string };
    Body: {
      title?: string;
      summary?: string;
      instructionsMd?: string;
      durationMinutes?: number;
      status?: 'draft' | 'published' | 'archived';
    };
  }>(
    '/api/company/assessments/:assessmentId',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 3, maxLength: 160 },
            summary: { type: 'string', maxLength: 600 },
            instructionsMd: { type: 'string', minLength: 10 },
            durationMinutes: { type: 'integer', minimum: 15, maximum: 480 },
            status: { type: 'string', enum: ['draft', 'published', 'archived'] },
          },
        },
      },
    },
    async (request, reply) => {
      const membership = await getCompanyMembership(request.user.id);
      if (!membership) {
        return reply.status(403).send({ error: 'Company access required' });
      }

      const updates: Record<string, unknown> = {};
      if (request.body.title !== undefined) updates.title = request.body.title.trim();
      if (request.body.summary !== undefined) updates.summary = request.body.summary.trim();
      if (request.body.instructionsMd !== undefined) {
        updates.instructions_md = request.body.instructionsMd.trim();
      }
      if (request.body.durationMinutes !== undefined) {
        updates.duration_minutes = request.body.durationMinutes;
      }
      if (request.body.status !== undefined) {
        updates.status = request.body.status;
        if (request.body.status === 'published') {
          updates.published_at = new Date().toISOString();
        }
      }

      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from('assessments')
        .update(updates)
        .eq('id', request.params.assessmentId)
        .eq('company_id', membership.companyId)
        .select()
        .single();

      if (error || !data) {
        return reply.status(404).send({ error: 'Assessment not found or update failed' });
      }

      return {
        id: data.id,
        title: data.title,
        summary: data.summary,
        instructionsMd: data.instructions_md,
        durationMinutes: data.duration_minutes,
        status: data.status,
        publishedAt: data.published_at,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },
  );

  fastify.post<{
    Params: { assessmentId: string };
  }>(
    '/api/company/assessments/:assessmentId/publish',
    async (request, reply) => {
      const membership = await getCompanyMembership(request.user.id);
      if (!membership) {
        return reply.status(403).send({ error: 'Company access required' });
      }

      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from('assessments')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
        })
        .eq('id', request.params.assessmentId)
        .eq('company_id', membership.companyId)
        .select()
        .single();

      if (error || !data) {
        return reply.status(404).send({ error: 'Assessment not found or publish failed' });
      }

      return {
        id: data.id,
        status: data.status,
        publishedAt: data.published_at,
      };
    },
  );

  fastify.get<{
    Params: { assessmentId: string };
  }>(
    '/api/company/assessments/:assessmentId/assignments',
    async (request, reply) => {
      const membership = await getCompanyMembership(request.user.id);
      if (!membership) {
        return reply.status(403).send({ error: 'Company access required' });
      }

      const supabase = getSupabaseAdmin();
      const { data: assignments, error } = await supabase
        .from('assessment_assignments')
        .select('*')
        .eq('assessment_id', request.params.assessmentId)
        .eq('company_id', membership.companyId)
        .order('created_at', { ascending: false });

      if (error) {
        return reply.status(500).send({ error: 'Failed to fetch assignments' });
      }

      const assignmentIds = (assignments ?? []).map((a) => a.id as string);

      // Batch-fetch sessions for all assignments
      let sessionByAssignment = new Map<string, any>();
      let submissionBySession = new Map<string, any>();

      if (assignmentIds.length > 0) {
        const { data: sessions } = await supabase
          .from('sessions')
          .select('id, assignment_id, status')
          .in('assignment_id', assignmentIds);

        sessionByAssignment = new Map(
          (sessions ?? []).map((s) => [s.assignment_id as string, s]),
        );

        const sessionIds = (sessions ?? []).map((s) => s.id as string);
        if (sessionIds.length > 0) {
          const { data: subs } = await supabase
            .from('final_submissions')
            .select('session_id, total_commands_run, total_file_changes, session_duration_seconds, total_disconnections, total_claude_prompts, total_claude_tool_calls, submitted_at')
            .in('session_id', sessionIds);
          submissionBySession = new Map(
            (subs ?? []).map((s) => [s.session_id as string, s]),
          );
        }
      }

      return (assignments ?? []).map((assignment) => {
        const session = sessionByAssignment.get(assignment.id as string);
        const submission = session
          ? submissionBySession.get(session.id as string)
          : null;

        return {
          id: assignment.id,
          candidateEmail: assignment.candidate_email,
          status: assignment.status,
          claimedAt: assignment.claimed_at,
          startedAt: assignment.started_at,
          completedAt: assignment.completed_at,
          createdAt: assignment.created_at,
          sessionId: session ? (session.id as string) : null,
          sessionStatus: session ? (session.status as string) : null,
          submission: submission
            ? {
                totalCommandsRun: submission.total_commands_run,
                totalFileChanges: submission.total_file_changes,
                sessionDurationSeconds: submission.session_duration_seconds,
                totalDisconnections: submission.total_disconnections,
                totalClaudePrompts: submission.total_claude_prompts,
                totalClaudeToolCalls: submission.total_claude_tool_calls,
                submittedAt: submission.submitted_at,
              }
            : null,
        };
      });
    },
  );

  fastify.post<{
    Params: { assessmentId: string };
    Body: { emails: string[] };
  }>(
    '/api/company/assessments/:assessmentId/assignments',
    {
      schema: {
        body: {
          type: 'object',
          required: ['emails'],
          properties: {
            emails: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', minLength: 3 },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const membership = await getCompanyMembership(request.user.id);
      if (!membership) {
        return reply.status(403).send({ error: 'Company access required' });
      }

      const supabase = getSupabaseAdmin();
      const { data: assessment, error: assessmentError } = await supabase
        .from('assessments')
        .select('id, status')
        .eq('id', request.params.assessmentId)
        .eq('company_id', membership.companyId)
        .single();

      if (assessmentError || !assessment) {
        return reply.status(404).send({ error: 'Assessment not found' });
      }

      const normalizedMap = new Map<string, string>();
      for (const rawEmail of request.body.emails) {
        const trimmed = rawEmail.trim();
        const normalized = normalizeEmail(trimmed);
        if (!normalized.includes('@')) continue;
        if (!normalizedMap.has(normalized)) {
          normalizedMap.set(normalized, trimmed);
        }
      }

      const normalizedEmails = Array.from(normalizedMap.keys());
      if (normalizedEmails.length === 0) {
        return reply.status(400).send({ error: 'No valid email addresses provided' });
      }

      const { data: existing } = await supabase
        .from('assessment_assignments')
        .select('candidate_email_normalized')
        .eq('assessment_id', assessment.id)
        .in('candidate_email_normalized', normalizedEmails);

      const existingSet = new Set((existing ?? []).map((row) => row.candidate_email_normalized as string));
      const rows = normalizedEmails
        .filter((email) => !existingSet.has(email))
        .map((email) => ({
          assessment_id: assessment.id,
          company_id: membership.companyId,
          candidate_email: normalizedMap.get(email) ?? email,
          candidate_email_normalized: email,
        }));

      if (rows.length > 0) {
        const { error } = await supabase.from('assessment_assignments').insert(rows);
        if (error) {
          return reply.status(500).send({ error: 'Failed to create assignments' });
        }
      }

      return reply.status(201).send({
        created: rows.length,
        skipped: normalizedEmails.filter((email) => existingSet.has(email)),
      });
    },
  );

  fastify.get('/api/candidate/assignments', async (request) => {
    await claimAssignmentsForUser(request.user.id, request.user.email);

    const supabase = getSupabaseAdmin();
    const { data: assignments } = await supabase
      .from('assessment_assignments')
      .select('*')
      .eq('candidate_user_id', request.user.id)
      .order('created_at', { ascending: false });

    if (!assignments || assignments.length === 0) {
      return [];
    }

    const assessmentIds = Array.from(
      new Set(assignments.map((assignment) => assignment.assessment_id as string)),
    );
    const companyIds = Array.from(
      new Set(assignments.map((assignment) => assignment.company_id as string)),
    );
    const assignmentIds = assignments.map((assignment) => assignment.id as string);

    const [{ data: assessments }, { data: companies }, { data: sessions }] = await Promise.all([
      supabase.from('assessments').select('*').in('id', assessmentIds),
      supabase.from('companies').select('id, name').in('id', companyIds),
      supabase.from('sessions').select('*').in('assignment_id', assignmentIds),
    ]);

    const assessmentMap = new Map((assessments ?? []).map((row) => [row.id as string, row]));
    const companyMap = new Map((companies ?? []).map((row) => [row.id as string, row]));
    const sessionMap = new Map((sessions ?? []).map((row) => [row.assignment_id as string, row]));

    return assignments.map((assignment) => {
      const assessment = assessmentMap.get(assignment.assessment_id as string);
      const company = companyMap.get(assignment.company_id as string);
      const session = sessionMap.get(assignment.id as string);

      return {
        id: assignment.id,
        candidateEmail: assignment.candidate_email,
        status: assignment.status,
        claimedAt: assignment.claimed_at,
        startedAt: assignment.started_at,
        completedAt: assignment.completed_at,
        createdAt: assignment.created_at,
        assessment: assessment
          ? {
              id: assessment.id,
              title: assessment.title,
              summary: assessment.summary,
              instructionsMd: assessment.instructions_md,
              durationMinutes: assessment.duration_minutes,
              status: assessment.status,
              publishedAt: assessment.published_at,
            }
          : null,
        company: company
          ? {
              id: company.id,
              name: company.name,
            }
          : null,
        session: session
          ? {
              id: session.id,
              status: session.status,
              createdAt: session.created_at,
              stoppedAt: session.stopped_at,
            }
          : null,
      };
    });
  });

  fastify.post<{
    Params: { assignmentId: string };
  }>(
    '/api/candidate/assignments/:assignmentId/start',
    async (request, reply) => {
      await claimAssignmentsForUser(request.user.id, request.user.email);

      try {
        const result = await sessionManager.createSessionForAssignment(
          request.user.id,
          request.params.assignmentId,
        );
        return reply.status(201).send({
          id: result.session.id,
          assignmentId: result.assignmentId,
          assessmentId: result.assessmentId,
          status: result.session.status,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start assessment';
        const statusCode =
          message.includes('not found') ? 404 :
          message.includes('active session') || message.includes('completed session') ? 409 :
          message.includes('claimed') || message.includes('cannot be started') ? 403 :
          500;

        return reply.status(statusCode).send({ error: message });
      }
    },
  );
}
