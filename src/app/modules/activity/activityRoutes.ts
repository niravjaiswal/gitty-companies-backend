import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import type { SessionManager } from '../sessions/sessionManager.js';
import { authenticate } from '../../infra/auth/auth.js';
import { getSupabaseAdmin } from '../../infra/db/supabase.js';
import { getCompanyMembership } from '../../infra/auth/companyAuth.js';

interface ActivityRouteOptions extends FastifyPluginOptions {
  sessionManager: SessionManager;
}

/**
 * Helper: fetch session and verify ownership.
 * Unlike getOwnedRunningSession in sandbox.ts, this does NOT require 'running' status —
 * activity data should be viewable even after a session ends.
 *
 * Authorization paths:
 * 1. Direct ownership: session.userId matches the requesting user
 * 2. Company membership: the session's assignment belongs to the requesting user's company
 */
async function getOwnedSession(
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
  sessionManager: SessionManager,
) {
  const session = await sessionManager.getSession(request.params.sessionId);
  if (!session) {
    reply.status(404).send({ error: 'Session not found' });
    return null;
  }

  // Direct ownership
  if (session.userId === request.user.id) return session;

  // Company membership: session's assignment belongs to user's company
  if (session.assignmentId) {
    const membership = await getCompanyMembership(request.user.id);
    if (membership) {
      const supabase = getSupabaseAdmin();
      const { data } = await supabase
        .from('assessment_assignments')
        .select('id')
        .eq('id', session.assignmentId)
        .eq('company_id', membership.companyId)
        .maybeSingle();
      if (data) return session;
    }
  }

  reply.status(403).send({ error: 'Not authorized for this session' });
  return null;
}

/**
 * Fastify plugin that registers activity monitoring API routes.
 * All routes require authentication via Bearer token.
 */
export async function activityRoutes(
  fastify: FastifyInstance,
  opts: ActivityRouteOptions,
): Promise<void> {
  const { sessionManager } = opts;

  // Add auth to all routes in this plugin
  fastify.addHook('preHandler', authenticate);

  // ── GET /api/sessions/:sessionId/activity ──────────────────────────────
  // Returns paginated activity events with optional filters.

  fastify.get<{
    Params: { sessionId: string };
    Querystring: {
      from?: string;
      to?: string;
      type?: string;
      limit?: number;
      offset?: number;
    };
  }>(
    '/api/sessions/:sessionId/activity',
    {
      schema: {
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: {
            sessionId: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            type: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const session = await getOwnedSession(request, reply, sessionManager);
      if (!session) return;

      const { from, to, type } = request.query;
      const limit = request.query.limit ?? 100;
      const offset = request.query.offset ?? 0;

      const supabase = getSupabaseAdmin();

      // Build query for events
      let query = supabase
        .from('session_activity')
        .select('*')
        .eq('session_id', session.id)
        .order('occurred_at', { ascending: true });

      if (from) {
        query = query.gte('occurred_at', from);
      }
      if (to) {
        query = query.lte('occurred_at', to);
      }
      if (type) {
        query = query.eq('event_type', type);
      }

      query = query.range(offset, offset + limit - 1);

      const { data: events, error } = await query;

      if (error) {
        return reply.status(500).send({ error: 'Failed to query activity events' });
      }

      // Get total count with the same filters
      let countQuery = supabase
        .from('session_activity')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', session.id);

      if (from) {
        countQuery = countQuery.gte('occurred_at', from);
      }
      if (to) {
        countQuery = countQuery.lte('occurred_at', to);
      }
      if (type) {
        countQuery = countQuery.eq('event_type', type);
      }

      const { count } = await countQuery;

      return { events: events ?? [], total: count ?? 0 };
    },
  );

  // ── GET /api/sessions/:sessionId/snapshots ─────────────────────────────
  // Returns list of snapshot metadata WITHOUT file contents.

  fastify.get<{
    Params: { sessionId: string };
  }>(
    '/api/sessions/:sessionId/snapshots',
    {
      schema: {
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: {
            sessionId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const session = await getOwnedSession(request, reply, sessionManager);
      if (!session) return;

      const supabase = getSupabaseAdmin();

      const { data: snapshots, error } = await supabase
        .from('code_snapshots')
        .select('id, snapshot_at, file_count, total_bytes, collected_at')
        .eq('session_id', session.id)
        .order('snapshot_at', { ascending: true });

      if (error) {
        return reply.status(500).send({ error: 'Failed to query snapshots' });
      }

      return { snapshots: snapshots ?? [] };
    },
  );

  // ── GET /api/sessions/:sessionId/snapshots/:snapshotId ─────────────────
  // Returns a single snapshot with full file contents.

  fastify.get<{
    Params: { sessionId: string; snapshotId: string };
  }>(
    '/api/sessions/:sessionId/snapshots/:snapshotId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['sessionId', 'snapshotId'],
          properties: {
            sessionId: { type: 'string' },
            snapshotId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const session = await getOwnedSession(request, reply, sessionManager);
      if (!session) return;

      const supabase = getSupabaseAdmin();

      const { data: snapshot, error } = await supabase
        .from('code_snapshots')
        .select('*')
        .eq('id', request.params.snapshotId)
        .eq('session_id', session.id)
        .single();

      if (error || !snapshot) {
        return reply.status(404).send({ error: 'Snapshot not found' });
      }

      return snapshot;
    },
  );

  // ── GET /api/sessions/:sessionId/submission ────────────────────────────
  // Returns the final submission for a session.

  fastify.get<{
    Params: { sessionId: string };
  }>(
    '/api/sessions/:sessionId/submission',
    {
      schema: {
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: {
            sessionId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const session = await getOwnedSession(request, reply, sessionManager);
      if (!session) return;

      const supabase = getSupabaseAdmin();

      const { data: submission, error } = await supabase
        .from('final_submissions')
        .select('*')
        .eq('session_id', session.id)
        .single();

      if (error || !submission) {
        return reply.status(404).send({ error: 'Submission not found' });
      }

      return submission;
    },
  );

  // ── GET /api/sessions/:sessionId/timeline ──────────────────────────────
  // Convenience endpoint returning a merged chronological timeline.

  fastify.get<{
    Params: { sessionId: string };
  }>(
    '/api/sessions/:sessionId/timeline',
    {
      schema: {
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: {
            sessionId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const session = await getOwnedSession(request, reply, sessionManager);
      if (!session) return;

      const supabase = getSupabaseAdmin();

      // 1. Get all activity events
      const { data: events, error: eventsError } = await supabase
        .from('session_activity')
        .select('event_type, detail, occurred_at')
        .eq('session_id', session.id)
        .order('occurred_at', { ascending: true });

      if (eventsError) {
        return reply.status(500).send({ error: 'Failed to query activity events' });
      }

      // 2. Get snapshot metadata
      const { data: snapshots, error: snapshotsError } = await supabase
        .from('code_snapshots')
        .select('id, snapshot_at')
        .eq('session_id', session.id)
        .order('snapshot_at', { ascending: true });

      if (snapshotsError) {
        return reply.status(500).send({ error: 'Failed to query snapshots' });
      }

      // 3. Build timeline entries
      interface TimelineEntry {
        at: string;
        type: string;
        detail?: string | null;
        snapshot_id?: number;
      }

      const timeline: TimelineEntry[] = [];

      // Add activity events
      for (const event of events ?? []) {
        timeline.push({
          at: event.occurred_at,
          type: event.event_type,
          detail: event.detail,
        });
      }

      // Add snapshot entries
      for (const snap of snapshots ?? []) {
        timeline.push({
          at: snap.snapshot_at,
          type: 'snapshot',
          snapshot_id: snap.id,
        });
      }

      // 4. Sort by timestamp
      timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

      // 5. Calculate summary stats
      const totalCommands = (events ?? []).filter(
        (e) => e.event_type === 'command_run',
      ).length;
      const totalFileChanges = (events ?? []).filter((e) =>
        ['file_create', 'file_modify', 'file_delete', 'file_move'].includes(e.event_type),
      ).length;
      const totalClaudePrompts = (events ?? []).filter(
        (e) => e.event_type === 'claude_prompt',
      ).length;
      const totalClaudeToolCalls = (events ?? []).filter(
        (e) => e.event_type === 'claude_tool_use',
      ).length;

      const sessionCreatedAt = session.createdAt.getTime();
      const endTime = session.stoppedAt ? session.stoppedAt.getTime() : Date.now();
      const totalDurationSeconds = Math.round((endTime - sessionCreatedAt) / 1000);

      return {
        timeline,
        total_duration_seconds: totalDurationSeconds,
        total_commands: totalCommands,
        total_file_changes: totalFileChanges,
        total_claude_prompts: totalClaudePrompts,
        total_claude_tool_calls: totalClaudeToolCalls,
      };
    },
  );

  // ── GET /api/sessions/:sessionId/claude-transcripts ──────────────────────
  // Returns Claude transcript metadata list.

  fastify.get<{
    Params: { sessionId: string };
  }>(
    '/api/sessions/:sessionId/claude-transcripts',
    {
      schema: {
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: {
            sessionId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const session = await getOwnedSession(request, reply, sessionManager);
      if (!session) return;

      const supabase = getSupabaseAdmin();

      const { data: transcripts, error } = await supabase
        .from('claude_transcripts')
        .select('id, claude_session_id, total_prompts, total_tool_calls, total_tokens_in, total_tokens_out, collected_at')
        .eq('session_id', session.id)
        .order('collected_at', { ascending: true });

      if (error) {
        return reply.status(500).send({ error: 'Failed to query Claude transcripts' });
      }

      return { transcripts: transcripts ?? [] };
    },
  );

  // ── GET /api/sessions/:sessionId/claude-transcripts/:transcriptId ───────
  // Returns a single Claude transcript including full JSONL content.

  fastify.get<{
    Params: { sessionId: string; transcriptId: string };
  }>(
    '/api/sessions/:sessionId/claude-transcripts/:transcriptId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['sessionId', 'transcriptId'],
          properties: {
            sessionId: { type: 'string' },
            transcriptId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const session = await getOwnedSession(request, reply, sessionManager);
      if (!session) return;

      const supabase = getSupabaseAdmin();

      const { data: transcript, error } = await supabase
        .from('claude_transcripts')
        .select('*')
        .eq('id', request.params.transcriptId)
        .eq('session_id', session.id)
        .single();

      if (error || !transcript) {
        return reply.status(404).send({ error: 'Transcript not found' });
      }

      return transcript;
    },
  );
}
