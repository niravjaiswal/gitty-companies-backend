import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { authenticate } from '../../infra/auth/auth.js';
import { getSupabaseAdmin } from '../../infra/db/supabase.js';
import { normalizeEmail } from '../../shared/utils/email.js';
import { getCompanyMembership } from '../../infra/auth/companyAuth.js';
import type { SessionManager } from '../sessions/sessionManager.js';
import {
  normalizeAuthoringConfig,
  normalizeStoredWorkspace,
  type AssessmentAuthoringConfig,
} from './assessmentWorkspace.js';
import { buildDemoAssessmentCopy, buildDemoWorkspace } from './demoWorkspace.js';

interface AssessmentRouteOptions extends FastifyPluginOptions {
  sessionManager: SessionManager;
}

function formatAssessmentPersistenceError(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const candidate = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };

  const parts = [candidate.message, candidate.details, candidate.hint]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');

  if (/workspace_(files|entry_file|generated_at)/i.test(parts)) {
    return 'Assessment workspace migration is not applied. Run migration 007_assessment_workspace.sql.';
  }

  return fallback;
}

function serializeAssessment(
  assessment: Record<string, any>,
  options?: { includeWorkspaceFiles?: boolean },
) {
  const workspace = normalizeStoredWorkspace(
    assessment.workspace_files,
    assessment.workspace_entry_file,
    assessment.workspace_generated_at,
  );

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
    sourceBrief: assessment.source_brief ?? '',
    skeletonId: assessment.skeleton_id ?? null,
    authoringConfig: normalizeAuthoringConfig(assessment.authoring_config),
    workspaceFileCount: Object.keys(workspace.files).length,
    workspaceEntryFile: workspace.entryFilePath || null,
    workspaceGeneratedAt: workspace.generatedAt,
    generationStatus: assessment.generation_status ?? null,
    generationError: assessment.generation_error ?? null,
    generationStartedAt: assessment.generation_started_at ?? null,
    generationCompletedAt: assessment.generation_completed_at ?? null,
    ...(options?.includeWorkspaceFiles
      ? {
          workspaceFiles: workspace.files,
        }
      : {}),
  };
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
        ...serializeAssessment(assessment),
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
      sourceBrief?: string;
      skeletonId?: string;
      authoringConfig?: AssessmentAuthoringConfig;
      status?: 'draft' | 'published';
      generateWorkspace?: boolean;
      demoMode?: boolean;
      demoCandidateEmail?: string;
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
            durationMinutes: { type: 'integer', minimum: 1, maximum: 480 },
            sourceBrief: { type: 'string', maxLength: 6000 },
            skeletonId: { type: 'string', maxLength: 120 },
            authoringConfig: {
              type: 'object',
              properties: {
                mode: { type: 'string', enum: ['single', 'multi'] },
                stages: {
                  type: 'array',
                  maxItems: 8,
                  items: {
                    type: 'object',
                    required: ['name', 'instructionsMd'],
                    properties: {
                      id: { type: 'string', maxLength: 80 },
                      name: { type: 'string', minLength: 1, maxLength: 120 },
                      objective: { type: 'string', maxLength: 300 },
                      instructionsMd: { type: 'string', minLength: 1, maxLength: 12000 },
                    },
                  },
                },
              },
            },
            status: { type: 'string', enum: ['draft', 'published'] },
            generateWorkspace: { type: 'boolean' },
            demoMode: { type: 'boolean' },
            demoCandidateEmail: { type: 'string', maxLength: 320 },
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
      const authoringConfig = normalizeAuthoringConfig(request.body.authoringConfig);
      const demoMode = request.body.demoMode === true;
      const demoCopy = demoMode
        ? buildDemoAssessmentCopy({
            title: request.body.title,
            summary: request.body.summary,
            instructionsMd: request.body.instructionsMd,
          })
        : null;
      const title = demoCopy?.title ?? request.body.title.trim();
      const summary = demoCopy?.summary ?? request.body.summary?.trim() ?? '';
      const instructionsMd = demoCopy?.instructionsMd ?? request.body.instructionsMd.trim();
      const sourceBrief = request.body.sourceBrief?.trim() ?? '';
      const shouldGenerateWorkspace = request.body.generateWorkspace ?? status === 'published';
      const skeletonId = request.body.skeletonId?.trim() || null;

      // Demo mode: synchronous generation (fast, static files)
      let workspace: {
        files: Record<string, string>;
        entryFilePath: string;
        generatedAt: string | null;
      } = {
        files: {},
        entryFilePath: '',
        generatedAt: null,
      };
      if (shouldGenerateWorkspace && demoMode) {
        try {
          workspace = await buildDemoWorkspace({ title, instructionsMd });
        } catch (error) {
          fastify.log.error({ error }, 'Failed to generate demo workspace');
          return reply.status(502).send({ error: 'Failed to generate demo workspace' });
        }
      }

      // Non-demo generation: dispatch to async queue
      const shouldQueueGeneration = shouldGenerateWorkspace && !demoMode;

      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from('assessments')
        .insert({
          company_id: membership.companyId,
          created_by: request.user.id,
          title,
          summary,
          instructions_md: instructionsMd,
          duration_minutes: request.body.durationMinutes,
          source_brief: sourceBrief,
          skeleton_id: skeletonId,
          authoring_config: authoringConfig,
          workspace_files: workspace.files,
          workspace_entry_file: workspace.entryFilePath,
          workspace_generated_at: workspace.generatedAt,
          generation_status: shouldQueueGeneration ? 'pending' : null,
          status,
          published_at: status === 'published' ? new Date().toISOString() : null,
        })
        .select()
        .single();

      if (error || !data) {
        fastify.log.error({ error }, 'Failed to persist generated assessment');
        return reply.status(500).send({
          error: formatAssessmentPersistenceError(error, 'Failed to create assessment'),
        });
      }

      const requestedDemoEmail =
        typeof request.body.demoCandidateEmail === 'string'
          ? normalizeEmail(request.body.demoCandidateEmail)
          : '';
      const shouldSeedDemoAssignment = demoMode && requestedDemoEmail.includes('@');

      let demoAssignmentCreated = false;
      if (shouldSeedDemoAssignment) {
        const { data: existingAssignment } = await supabase
          .from('assessment_assignments')
          .select('id')
          .eq('assessment_id', data.id)
          .eq('candidate_email_normalized', requestedDemoEmail)
          .maybeSingle();

        if (!existingAssignment) {
          const { error: assignmentError } = await supabase.from('assessment_assignments').insert({
            assessment_id: data.id,
            company_id: membership.companyId,
            candidate_email: request.body.demoCandidateEmail?.trim() ?? requestedDemoEmail,
            candidate_email_normalized: requestedDemoEmail,
          });

          if (assignmentError) {
            fastify.log.error({ assignmentError }, 'Failed to create demo assignment');
          } else {
            demoAssignmentCreated = true;
          }
        }
      }

      const responseStatus = shouldQueueGeneration ? 202 : 201;
      return reply.status(responseStatus).send({
        ...serializeAssessment(data),
        demoMode,
        demoCandidateEmail: shouldSeedDemoAssignment ? requestedDemoEmail : null,
        demoAssignmentCreated,
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

      return serializeAssessment(data, { includeWorkspaceFiles: true });
    },
  );

  fastify.patch<{
    Params: { assessmentId: string };
    Body: {
      title?: string;
      summary?: string;
      instructionsMd?: string;
      durationMinutes?: number;
      sourceBrief?: string;
      skeletonId?: string;
      authoringConfig?: AssessmentAuthoringConfig;
      status?: 'draft' | 'published' | 'archived';
      workspaceFiles?: Record<string, string>;
      workspaceEntryFile?: string | null;
      regenerateWorkspace?: boolean;
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
            durationMinutes: { type: 'integer', minimum: 1, maximum: 480 },
            sourceBrief: { type: 'string', maxLength: 6000 },
            skeletonId: { type: 'string', maxLength: 120 },
            authoringConfig: {
              type: 'object',
              properties: {
                mode: { type: 'string', enum: ['single', 'multi'] },
                stages: {
                  type: 'array',
                  maxItems: 8,
                  items: {
                    type: 'object',
                    required: ['name', 'instructionsMd'],
                    properties: {
                      id: { type: 'string', maxLength: 80 },
                      name: { type: 'string', minLength: 1, maxLength: 120 },
                      objective: { type: 'string', maxLength: 300 },
                      instructionsMd: { type: 'string', minLength: 1, maxLength: 12000 },
                    },
                  },
                },
              },
            },
            status: { type: 'string', enum: ['draft', 'published', 'archived'] },
            workspaceFiles: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
            workspaceEntryFile: { type: ['string', 'null'] },
            regenerateWorkspace: { type: 'boolean' },
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
      const { data: existing, error: existingError } = await supabase
        .from('assessments')
        .select('*')
        .eq('id', request.params.assessmentId)
        .eq('company_id', membership.companyId)
        .single();

      if (existingError || !existing) {
        return reply.status(404).send({ error: 'Assessment not found or update failed' });
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
      if (request.body.sourceBrief !== undefined) {
        updates.source_brief = request.body.sourceBrief.trim();
      }
      if (request.body.skeletonId !== undefined) {
        updates.skeleton_id = request.body.skeletonId.trim() || null;
      }
      if (request.body.authoringConfig !== undefined) {
        updates.authoring_config = normalizeAuthoringConfig(request.body.authoringConfig);
      }
      if (request.body.status !== undefined) {
        updates.status = request.body.status;
        if (request.body.status === 'published') {
          updates.published_at = new Date().toISOString();
        }
      }
      if (request.body.workspaceFiles !== undefined) {
        const normalizedWorkspace = normalizeStoredWorkspace(
          request.body.workspaceFiles,
          request.body.workspaceEntryFile,
          existing.workspace_generated_at,
        );
        updates.workspace_files = normalizedWorkspace.files;
        updates.workspace_entry_file = normalizedWorkspace.entryFilePath;
        updates.workspace_generated_at = new Date().toISOString();
      } else if (request.body.workspaceEntryFile !== undefined) {
        const normalizedWorkspace = normalizeStoredWorkspace(
          existing.workspace_files,
          request.body.workspaceEntryFile,
          existing.workspace_generated_at,
        );
        updates.workspace_entry_file = normalizedWorkspace.entryFilePath;
      }

      const shouldRegenerateWorkspace =
        request.body.regenerateWorkspace === true ||
        ((request.body.title !== undefined ||
          request.body.summary !== undefined ||
          request.body.instructionsMd !== undefined ||
          request.body.sourceBrief !== undefined ||
          request.body.authoringConfig !== undefined) &&
          request.body.regenerateWorkspace !== false);

      if (shouldRegenerateWorkspace) {
        // Queue async regeneration instead of blocking
        updates.generation_status = 'pending';
        updates.generation_error = null;
        updates.generation_started_at = null;
        updates.generation_completed_at = null;
        // Clear existing workspace so stale files aren't served
        updates.workspace_files = {};
        updates.workspace_entry_file = '';
        updates.workspace_generated_at = null;
      }

      const { data, error } = await supabase
        .from('assessments')
        .update(updates)
        .eq('id', request.params.assessmentId)
        .eq('company_id', membership.companyId)
        .select()
        .single();

      if (error || !data) {
        fastify.log.error({ error }, 'Failed to update generated assessment');
        return reply.status(500).send({
          error: formatAssessmentPersistenceError(
            error,
            'Assessment not found or update failed',
          ),
        });
      }

      return serializeAssessment(data);
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
          message.includes('workspace') ? 502 :
          500;

        return reply.status(statusCode).send({ error: message });
      }
    },
  );
}
