import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sandboxRoutes } from '../sessionRoutes.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../infra/auth/auth.js', () => ({
  authenticate: async (request: any) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return;
    }
    if (authHeader === 'Bearer wrong-user-token') {
      request.user = { id: 'other-user-id', email: 'other@test.com' };
    } else {
      request.user = { id: 'test-user-id', email: 'test@test.com' };
    }
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            name: 'submit_scores',
            input: {
              reasoning: 8,
              correctness: 7,
              codeQuality: 8,
              speed: 6,
              vibe: 9,
              summary: 'Good work',
              redFlags: [],
              greenFlags: ['Clean code'],
            },
          },
        ],
      }),
    },
  })),
}));

// Chainable query builder mock helper
function createQueryBuilder(resolveValue: { data: any; error: any; count?: number | null }) {
  const builder: Record<string, any> = {};
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
    'in', 'is', 'like', 'ilike', 'or',
    'order', 'limit', 'range', 'single', 'maybeSingle',
  ];
  for (const method of methods) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  // The terminal call (awaiting the builder) resolves to our value
  builder.then = (resolve: any) => resolve(resolveValue);
  return builder;
}

let mockSupabaseFrom: any;

vi.mock('../../../infra/db/supabase.js', () => ({
  getSupabaseAdmin: () => ({
    from: (...args: any[]) => mockSupabaseFrom(...args),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id', email: 'test@test.com' } },
        error: null,
      }),
    },
  }),
}));

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_USER_ID = 'test-user-id';
const TEST_SESSION_ID = 'session-123';

// ── Mocked plugin deps ───────────────────────────────────────────────────────

const mockSessionManager = {
  getSession: vi.fn(),
  createSession: vi.fn(),
  createSessionForAssignment: vi.fn(),
  getActiveSessionByUserId: vi.fn(),
  getSessionHistory: vi.fn(),
  updateActivity: vi.fn(),
  stopSession: vi.fn(),
  disconnectSession: vi.fn(),
  reconnectSession: vi.fn(),
  abandonSession: vi.fn(),
  cleanupStaleSessions: vi.fn(),
  startCleanupInterval: vi.fn(),
  stopCleanupInterval: vi.fn(),
  stopAllSessions: vi.fn(),
  cleanupOrphanedSessions: vi.fn(),
};

const mockSandboxService = {
  runCommand: vi.fn(),
  listDirectory: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sandboxRoutes, {
    sessionManager: mockSessionManager as any,
    sandboxService: mockSandboxService as any,
  });
  await app.ready();
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Session routes', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    mockSupabaseFrom = vi.fn();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/sessions/:sessionId/submission
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/sessions/:sessionId/submission', () => {
    const baseUrl = `/api/sessions/${TEST_SESSION_ID}/submission`;

    it('returns 404 when session not found in DB', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'sessions') {
          return createQueryBuilder({ data: null, error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Session not found' });
    });

    it('returns 404 (not 403) when session belongs to a different user (IDOR safe)', async () => {
      // Session exists but belongs to a different user
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'sessions') {
          return createQueryBuilder({
            data: { id: TEST_SESSION_ID, user_id: 'someone-else' },
            error: null,
          });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp();

      // wrong-user-token attaches user id 'other-user-id'
      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer wrong-user-token' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Session not found' });
    });

    it('returns 404 when session owned but no submission exists', async () => {
      let callIndex = 0;
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'sessions') {
          return createQueryBuilder({
            data: { id: TEST_SESSION_ID, user_id: TEST_USER_ID },
            error: null,
          });
        }
        if (table === 'final_submissions') {
          return createQueryBuilder({ data: null, error: null });
        }
        callIndex++;
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Submission not found' });
    });

    it('returns 200 with submission data when session owned and submission exists', async () => {
      const mockSubmission = {
        files: { 'index.ts': 'console.log("hi")' },
        file_count: 1,
        total_bytes: 20,
        ai_scores: null,
        scoring_status: 'pending',
        scoring_started_at: null,
        session_duration_seconds: 3600,
        total_claude_prompts: 5,
        total_claude_tool_calls: 10,
      };

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'sessions') {
          return createQueryBuilder({
            data: { id: TEST_SESSION_ID, user_id: TEST_USER_ID },
            error: null,
          });
        }
        if (table === 'final_submissions') {
          return createQueryBuilder({ data: mockSubmission, error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockSubmission);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/sessions/:sessionId/claude-transcripts/:transcriptId
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/sessions/:sessionId/claude-transcripts/:transcriptId', () => {
    const transcriptUrl = (tid: string | number) =>
      `/api/sessions/${TEST_SESSION_ID}/claude-transcripts/${tid}`;

    it('returns 400 when transcriptId is not an integer', async () => {
      app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: transcriptUrl('abc'),
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when session not found', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'sessions') {
          return createQueryBuilder({ data: null, error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: transcriptUrl(42),
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Session not found' });
    });

    it('returns 404 (not 403) when session belongs to a different user (IDOR safe)', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'sessions') {
          return createQueryBuilder({
            data: { id: TEST_SESSION_ID, user_id: 'someone-else' },
            error: null,
          });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: transcriptUrl(42),
        headers: { authorization: 'Bearer wrong-user-token' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Session not found' });
    });

    it('returns 404 when session owned but transcript not found', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'sessions') {
          return createQueryBuilder({
            data: { id: TEST_SESSION_ID, user_id: TEST_USER_ID },
            error: null,
          });
        }
        if (table === 'claude_transcripts') {
          return createQueryBuilder({ data: null, error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: transcriptUrl(42),
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Transcript not found' });
    });

    it('returns 200 with transcript data when session owned and transcript exists', async () => {
      const mockTranscript = {
        transcript_jsonl: '{"type":"human","content":"Hello"}\n{"type":"assistant","content":"Hi"}',
        claude_session_id: 'claude-abc-123',
        total_prompts: 2,
        total_tool_calls: 0,
      };

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'sessions') {
          return createQueryBuilder({
            data: { id: TEST_SESSION_ID, user_id: TEST_USER_ID },
            error: null,
          });
        }
        if (table === 'claude_transcripts') {
          return createQueryBuilder({ data: mockTranscript, error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: transcriptUrl(42),
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockTranscript);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/sessions/:sessionId/score
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/sessions/:sessionId/score', () => {
    const scoreUrl = `/api/sessions/${TEST_SESSION_ID}/score`;

    it('returns 404 when session not found', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'sessions') {
          return createQueryBuilder({ data: null, error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: scoreUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Session not found' });
    });

    it('returns 404 when session belongs to a different user', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'sessions') {
          return createQueryBuilder({
            data: { id: TEST_SESSION_ID, user_id: 'someone-else' },
            error: null,
          });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: scoreUrl,
        headers: { authorization: 'Bearer wrong-user-token' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Session not found' });
    });

    it('returns 404 when session owned but no submission exists', async () => {
      let fromCallCount = 0;
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'sessions') {
          return createQueryBuilder({
            data: { id: TEST_SESSION_ID, user_id: TEST_USER_ID },
            error: null,
          });
        }
        if (table === 'final_submissions') {
          fromCallCount++;
          // First call is the SELECT for submission data
          return createQueryBuilder({ data: null, error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: scoreUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Submission not found' });
    });

    it('returns 409 when scoring is already pending or complete (idempotency guard)', async () => {
      const mockSubmission = {
        files: { 'index.ts': 'const x = 1;' },
        session_duration_seconds: 1800,
        scoring_status: 'pending',
      };

      let finalSubmissionsCallCount = 0;
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'sessions') {
          return createQueryBuilder({
            data: { id: TEST_SESSION_ID, user_id: TEST_USER_ID },
            error: null,
          });
        }
        if (table === 'final_submissions') {
          finalSubmissionsCallCount++;
          if (finalSubmissionsCallCount === 1) {
            // First call: SELECT submission
            return createQueryBuilder({ data: mockSubmission, error: null });
          } else {
            // Second call: UPDATE with idempotency guard — returns count=0 (already pending/complete)
            return createQueryBuilder({ data: null, error: null, count: 0 });
          }
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: scoreUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'Scoring already in progress or complete' });
    });

    it('returns 202 and fires async scoring when update succeeds (count=1)', async () => {
      const mockSubmission = {
        files: { 'index.ts': 'const x = 1;' },
        session_duration_seconds: 1800,
        scoring_status: null,
      };

      let finalSubmissionsCallCount = 0;
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'sessions') {
          return createQueryBuilder({
            data: { id: TEST_SESSION_ID, user_id: TEST_USER_ID },
            error: null,
          });
        }
        if (table === 'final_submissions') {
          finalSubmissionsCallCount++;
          if (finalSubmissionsCallCount === 1) {
            // First call: SELECT submission
            return createQueryBuilder({ data: mockSubmission, error: null });
          } else {
            // Second call: UPDATE — returns count=1 (was null or failed, now set to pending)
            return createQueryBuilder({ data: null, error: null, count: 1 });
          }
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: scoreUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      // Route returns 202 immediately — async scoring fires in background via setImmediate
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ status: 'pending' });
    });
  });
});
