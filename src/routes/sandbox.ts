import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { SessionManager } from '../services/sessionManager.js';
import type { SandboxService } from '../services/sandbox.js';
import { authenticate } from '../middleware/auth.js';
import { getSupabaseAdmin } from '../db/supabase.js';

interface SandboxRouteOptions extends FastifyPluginOptions {
  sessionManager: SessionManager;
  sandboxService: SandboxService;
}

/**
 * Fastify plugin that registers all sandbox/session API routes.
 * All routes require authentication via Bearer token.
 */
export async function sandboxRoutes(
  fastify: FastifyInstance,
  opts: SandboxRouteOptions,
): Promise<void> {
  const { sessionManager, sandboxService } = opts;

  const SANDBOX_ROOT = '/vercel/sandbox';

  /** Validates that a path is within the sandbox root to prevent path traversal. */
  function isValidSandboxPath(filePath: string): boolean {
    const normalized = filePath.replace(/\/+/g, '/').replace(/\/$/, '');
    return normalized.startsWith(SANDBOX_ROOT + '/') || normalized === SANDBOX_ROOT;
  }

  // Add auth to all routes in this plugin
  fastify.addHook('preHandler', authenticate);

  // ── Session routes ────────────────────────────────────────────────────

  /**
   * POST /api/sessions — Create a new session for the authenticated user
   */
  fastify.post('/api/sessions', async (request, reply) => {
    const userId = request.user.id;

    try {
      const session = await sessionManager.createSession(userId);
      return reply.status(201).send(session);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('already has an active session')) {
          return reply.status(409).send({ error: error.message });
        }
        if (error.message.includes('already used their session')) {
          return reply.status(403).send({ error: error.message });
        }
      }
      throw error;
    }
  });

  /**
   * GET /api/sessions/me — Get the authenticated user's active session (or null)
   */
  fastify.get('/api/sessions/me', async (request, reply) => {
    const session = await sessionManager.getActiveSessionByUserId(request.user.id);
    return reply.send(session ?? null);
  });

  /**
   * GET /api/sessions/history — Get the authenticated user's past sessions (last 10)
   */
  fastify.get('/api/sessions/history', async (request) => {
    return sessionManager.getSessionHistory(request.user.id);
  });

  /**
   * GET /api/sessions/:sessionId — Get session details (with ownership check)
   */
  fastify.get<{
    Params: { sessionId: string };
  }>(
    '/api/sessions/:sessionId',
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
      const session = await sessionManager.getSession(request.params.sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (session.userId !== request.user.id) {
        return reply.status(403).send({ error: 'Not authorized for this session' });
      }
      return session;
    },
  );

  /**
   * DELETE /api/sessions/:sessionId — Stop session and destroy sandbox
   */
  fastify.delete<{
    Params: { sessionId: string };
  }>(
    '/api/sessions/:sessionId',
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
      const session = await sessionManager.getSession(request.params.sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (session.userId !== request.user.id) {
        return reply.status(403).send({ error: 'Not authorized for this session' });
      }

      await sessionManager.stopSession(request.params.sessionId);
      return reply.status(200).send({ message: 'Session stopped' });
    },
  );

  // ── Profile routes ────────────────────────────────────────────────────

  /**
   * GET /api/profile — Get the authenticated user's profile
   */
  fastify.get('/api/profile', async (request, reply) => {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', request.user.id)
      .single();

    if (error || !data) {
      return reply.status(404).send({ error: 'Profile not found' });
    }
    return data;
  });

  /**
   * PATCH /api/profile — Update display_name and/or avatar_url
   */
  fastify.patch<{
    Body: { display_name?: string; avatar_url?: string };
  }>(
    '/api/profile',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            display_name: { type: 'string' },
            avatar_url: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { display_name, avatar_url } = request.body;
      const updates: Record<string, string> = {};
      if (display_name !== undefined) updates.display_name = display_name;
      if (avatar_url !== undefined) updates.avatar_url = avatar_url;

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({ error: 'No fields to update' });
      }

      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', request.user.id)
        .select()
        .single();

      if (error) {
        return reply.status(500).send({ error: 'Failed to update profile' });
      }
      return data;
    },
  );

  // ── File & exec routes (unchanged behavior, now auth-gated + ownership-checked) ─

  /**
   * Helper: fetch session and verify ownership, return session or send error response.
   */
  async function getOwnedRunningSession(
    request: { params: { sessionId: string }; user: { id: string } },
    reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  ) {
    const session = await sessionManager.getSession(request.params.sessionId);
    if (!session) {
      reply.status(404).send({ error: 'Session not found' });
      return null;
    }
    if (session.userId !== request.user.id) {
      reply.status(403).send({ error: 'Not authorized for this session' });
      return null;
    }
    if (session.status !== 'running') {
      reply.status(400).send({ error: `Session is not running (status: ${session.status})` });
      return null;
    }
    return session;
  }

  /**
   * POST /api/sessions/:sessionId/heartbeat — Keep session alive
   */
  fastify.post<{
    Params: { sessionId: string };
  }>(
    '/api/sessions/:sessionId/heartbeat',
    {
      schema: {
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const session = await sessionManager.getSession(request.params.sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      if (session.userId !== request.user.id) {
        return reply.status(403).send({ error: 'Not authorized for this session' });
      }

      await sessionManager.updateActivity(session.id);
      return { status: session.status };
    },
  );

  /**
   * POST /api/sessions/:sessionId/exec — Execute a command in the sandbox
   */
  fastify.post<{
    Params: { sessionId: string };
    Body: { cmd: string; args?: string[] };
  }>(
    '/api/sessions/:sessionId/exec',
    {
      schema: {
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: { type: 'string' } },
        },
        body: {
          type: 'object',
          required: ['cmd'],
          properties: {
            cmd: { type: 'string', minLength: 1 },
            args: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const session = await getOwnedRunningSession(request, reply);
      if (!session) return;

      const { cmd, args } = request.body;
      await sessionManager.updateActivity(session.id);

      const result = await sandboxService.runCommand(session.sandboxId, cmd, args);
      return result;
    },
  );

  /**
   * GET /api/sessions/:sessionId/files?path=/some/path
   */
  fastify.get<{
    Params: { sessionId: string };
    Querystring: { path: string };
  }>(
    '/api/sessions/:sessionId/files',
    {
      schema: {
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: { type: 'string' } },
        },
        querystring: {
          type: 'object',
          required: ['path'],
          properties: { path: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const session = await getOwnedRunningSession(request, reply);
      if (!session) return;

      const { path } = request.query;
      await sessionManager.updateActivity(session.id);

      try {
        const entries = await sandboxService.listDirectory(session.sandboxId, path);
        return { type: 'directory', entries };
      } catch {
        const content = await sandboxService.readFile(session.sandboxId, path);
        return { type: 'file', content };
      }
    },
  );

  /**
   * PUT /api/sessions/:sessionId/files — Write a file in the sandbox
   */
  fastify.put<{
    Params: { sessionId: string };
    Body: { path: string; content: string };
  }>(
    '/api/sessions/:sessionId/files',
    {
      schema: {
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: { type: 'string' } },
        },
        body: {
          type: 'object',
          required: ['path', 'content'],
          properties: {
            path: { type: 'string', minLength: 1 },
            content: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const session = await getOwnedRunningSession(request, reply);
      if (!session) return;

      const { path, content } = request.body;
      await sessionManager.updateActivity(session.id);

      await sandboxService.writeFile(session.sandboxId, path, content);
      return reply.status(200).send({ message: 'File written', path });
    },
  );

}
