import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { activityRoutes } from '../activity.js';
import type { Session } from '../../services/sessionManager.js';

// ── Mocks ───────────────────────────────────────────────────────────────────

// Mock the auth middleware so every request gets a test user attached
vi.mock('../../middleware/auth.js', () => ({
  authenticate: async (request: any) => {
    // If no Authorization header, simulate 401
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return request.server
        ? (request as any).raw // fastify inject handles reply via preHandler return
        : undefined;
    }
    // For the "wrong-user" token, attach a different user id
    if (authHeader === 'Bearer wrong-user-token') {
      request.user = { id: 'other-user-id', email: 'other@test.com' };
    // For the "company-member" token, attach a company member user
    } else if (authHeader === 'Bearer company-member-token') {
      request.user = { id: 'company-member-id', email: 'company@test.com' };
    } else {
      request.user = { id: 'test-user-id', email: 'test@test.com' };
    }
  },
}));

// Mock the companyAuth utility
const mockGetCompanyMembership = vi.fn();
vi.mock('../../utils/companyAuth.js', () => ({
  getCompanyMembership: (...args: any[]) => mockGetCompanyMembership(...args),
}));

// Chainable query builder mock helper
function createQueryBuilder(resolveValue: { data: any; error: any; count?: number | null }) {
  const builder: Record<string, any> = {};
  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
    'in', 'is', 'like', 'ilike',
    'order', 'limit', 'range', 'single', 'maybeSingle',
  ];
  for (const method of methods) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  // The terminal call (awaiting the builder) resolves to our value
  builder.then = (resolve: any) => resolve(resolveValue);
  return builder;
}

// We hold a reference to the mock supabase so each test can configure it
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockSupabaseFrom: any;

vi.mock('../../db/supabase.js', () => ({
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

// ── Test helpers ─────────────────────────────────────────────────────────────

const TEST_USER_ID = 'test-user-id';
const OTHER_USER_ID = 'other-user-id';
const TEST_SESSION_ID = 'session-123';
const NOW = new Date('2026-01-15T10:00:00Z');

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: TEST_SESSION_ID,
    userId: TEST_USER_ID,
    sandboxId: 'sandbox-abc',
    status: 'running',
    createdAt: new Date('2026-01-15T09:00:00Z'),
    lastActivityAt: NOW,
    disconnectedAt: null,
    stoppedAt: null,
    totalDisconnections: 0,
    codeServerUrl: 'https://code.example.com',
    assessmentId: null,
    assignmentId: null,
    ...overrides,
  };
}

function createMockSessionManager(session: Session | null = makeSession()) {
  return {
    getSession: vi.fn().mockResolvedValue(session),
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
}

async function buildApp(sessionManager: any): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(activityRoutes, { sessionManager });
  await app.ready();
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Activity routes', () => {
  let app: FastifyInstance;
  let sessionManager: ReturnType<typeof createMockSessionManager>;

  beforeEach(() => {
    sessionManager = createMockSessionManager();
    mockSupabaseFrom = vi.fn();
    mockGetCompanyMembership.mockReset();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Auth & ownership checks (shared across all routes)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('authentication and authorization', () => {
    it('returns 404 when session does not exist', async () => {
      sessionManager = createMockSessionManager(null);
      app = await buildApp(sessionManager);

      const routes = [
        `/api/sessions/${TEST_SESSION_ID}/activity`,
        `/api/sessions/${TEST_SESSION_ID}/snapshots`,
        `/api/sessions/${TEST_SESSION_ID}/snapshots/snap-1`,
        `/api/sessions/${TEST_SESSION_ID}/submission`,
        `/api/sessions/${TEST_SESSION_ID}/timeline`,
        `/api/sessions/${TEST_SESSION_ID}/claude-transcripts`,
        `/api/sessions/${TEST_SESSION_ID}/claude-transcripts/1`,
      ];

      for (const url of routes) {
        const res = await app.inject({
          method: 'GET',
          url,
          headers: { authorization: 'Bearer valid-token' },
        });
        expect(res.statusCode, `Expected 404 for ${url}`).toBe(404);
        expect(res.json()).toEqual({ error: 'Session not found' });
      }
    });

    it('returns 403 when session belongs to a different user', async () => {
      sessionManager = createMockSessionManager(makeSession({ userId: 'someone-else' }));
      app = await buildApp(sessionManager);

      const routes = [
        `/api/sessions/${TEST_SESSION_ID}/activity`,
        `/api/sessions/${TEST_SESSION_ID}/snapshots`,
        `/api/sessions/${TEST_SESSION_ID}/snapshots/snap-1`,
        `/api/sessions/${TEST_SESSION_ID}/submission`,
        `/api/sessions/${TEST_SESSION_ID}/timeline`,
        `/api/sessions/${TEST_SESSION_ID}/claude-transcripts`,
        `/api/sessions/${TEST_SESSION_ID}/claude-transcripts/1`,
      ];

      for (const url of routes) {
        const res = await app.inject({
          method: 'GET',
          url,
          headers: { authorization: 'Bearer valid-token' },
        });
        expect(res.statusCode, `Expected 403 for ${url}`).toBe(403);
        expect(res.json()).toEqual({ error: 'Not authorized for this session' });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/sessions/:sessionId/activity
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/sessions/:sessionId/activity', () => {
    const baseUrl = `/api/sessions/${TEST_SESSION_ID}/activity`;

    it('returns paginated activity events with defaults', async () => {
      const mockEvents = [
        { id: 1, session_id: TEST_SESSION_ID, event_type: 'command_run', detail: 'npm test', occurred_at: '2026-01-15T09:01:00Z' },
        { id: 2, session_id: TEST_SESSION_ID, event_type: 'file_modify', detail: 'index.ts', occurred_at: '2026-01-15T09:02:00Z' },
      ];

      // The route makes two queries to 'session_activity': one for data, one for count
      const dataBuilder = createQueryBuilder({ data: mockEvents, error: null });
      const countBuilder = createQueryBuilder({ data: null, error: null, count: 2 });

      let callIndex = 0;
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'session_activity') {
          callIndex++;
          return callIndex === 1 ? dataBuilder : countBuilder;
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events).toEqual(mockEvents);
      expect(body.total).toBe(2);
    });

    it('passes filter parameters to query', async () => {
      const dataBuilder = createQueryBuilder({ data: [], error: null });
      const countBuilder = createQueryBuilder({ data: null, error: null, count: 0 });

      let callIndex = 0;
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'session_activity') {
          callIndex++;
          return callIndex === 1 ? dataBuilder : countBuilder;
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: `${baseUrl}?from=2026-01-15T09:00:00Z&to=2026-01-15T10:00:00Z&type=command_run&limit=50&offset=10`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);

      // Verify the data builder was called with the correct filters
      expect(dataBuilder.eq).toHaveBeenCalledWith('session_id', TEST_SESSION_ID);
      expect(dataBuilder.gte).toHaveBeenCalledWith('occurred_at', '2026-01-15T09:00:00Z');
      expect(dataBuilder.lte).toHaveBeenCalledWith('occurred_at', '2026-01-15T10:00:00Z');
      expect(dataBuilder.eq).toHaveBeenCalledWith('event_type', 'command_run');
      expect(dataBuilder.range).toHaveBeenCalledWith(10, 59); // offset=10, limit=50 => range(10, 59)

      // Verify the count builder also got the same filters
      expect(countBuilder.eq).toHaveBeenCalledWith('session_id', TEST_SESSION_ID);
      expect(countBuilder.gte).toHaveBeenCalledWith('occurred_at', '2026-01-15T09:00:00Z');
      expect(countBuilder.lte).toHaveBeenCalledWith('occurred_at', '2026-01-15T10:00:00Z');
      expect(countBuilder.eq).toHaveBeenCalledWith('event_type', 'command_run');
    });

    it('returns empty events array when no events exist', async () => {
      const dataBuilder = createQueryBuilder({ data: [], error: null });
      const countBuilder = createQueryBuilder({ data: null, error: null, count: 0 });

      let callIndex = 0;
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'session_activity') {
          callIndex++;
          return callIndex === 1 ? dataBuilder : countBuilder;
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ events: [], total: 0 });
    });

    it('returns 500 when supabase query fails', async () => {
      const dataBuilder = createQueryBuilder({ data: null, error: { message: 'db error' } });
      const countBuilder = createQueryBuilder({ data: null, error: null, count: 0 });

      let callIndex = 0;
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'session_activity') {
          callIndex++;
          return callIndex === 1 ? dataBuilder : countBuilder;
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'Failed to query activity events' });
    });

    it('returns null-safe events when data is null', async () => {
      const dataBuilder = createQueryBuilder({ data: null, error: null });
      const countBuilder = createQueryBuilder({ data: null, error: null, count: null });

      let callIndex = 0;
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'session_activity') {
          callIndex++;
          return callIndex === 1 ? dataBuilder : countBuilder;
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ events: [], total: 0 });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/sessions/:sessionId/snapshots
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/sessions/:sessionId/snapshots', () => {
    const baseUrl = `/api/sessions/${TEST_SESSION_ID}/snapshots`;

    it('returns snapshot metadata list', async () => {
      const mockSnapshots = [
        { id: 'snap-1', snapshot_at: '2026-01-15T09:05:00Z', file_count: 3, total_bytes: 1024, collected_at: '2026-01-15T09:05:01Z' },
        { id: 'snap-2', snapshot_at: '2026-01-15T09:10:00Z', file_count: 5, total_bytes: 2048, collected_at: '2026-01-15T09:10:01Z' },
      ];

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'code_snapshots') {
          return createQueryBuilder({ data: mockSnapshots, error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ snapshots: mockSnapshots });
    });

    it('returns empty snapshots array when none exist', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'code_snapshots') {
          return createQueryBuilder({ data: [], error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ snapshots: [] });
    });

    it('selects only metadata columns (no file contents)', async () => {
      const builder = createQueryBuilder({ data: [], error: null });

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'code_snapshots') {
          return builder;
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      // The select call should specify only metadata columns, not '*'
      expect(builder.select).toHaveBeenCalledWith(
        'id, snapshot_at, file_count, total_bytes, collected_at',
      );
    });

    it('returns 500 when supabase query fails', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'code_snapshots') {
          return createQueryBuilder({ data: null, error: { message: 'db error' } });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'Failed to query snapshots' });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/sessions/:sessionId/snapshots/:snapshotId
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/sessions/:sessionId/snapshots/:snapshotId', () => {
    const baseUrl = `/api/sessions/${TEST_SESSION_ID}/snapshots/snap-1`;

    it('returns full snapshot with file contents', async () => {
      const mockSnapshot = {
        id: 'snap-1',
        session_id: TEST_SESSION_ID,
        snapshot_at: '2026-01-15T09:05:00Z',
        file_count: 2,
        total_bytes: 512,
        files: { 'index.ts': 'console.log("hello")' },
        collected_at: '2026-01-15T09:05:01Z',
      };

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'code_snapshots') {
          return createQueryBuilder({ data: mockSnapshot, error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockSnapshot);
    });

    it('returns 404 when snapshot does not exist', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'code_snapshots') {
          return createQueryBuilder({ data: null, error: { code: 'PGRST116', message: 'not found' } });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Snapshot not found' });
    });

    it('returns 404 when snapshot belongs to a different session', async () => {
      // The query uses .eq('session_id', session.id) so a mismatch returns no rows
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'code_snapshots') {
          return createQueryBuilder({ data: null, error: { code: 'PGRST116', message: 'not found' } });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${TEST_SESSION_ID}/snapshots/snap-from-other-session`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Snapshot not found' });
    });

    it('filters by both snapshotId and sessionId', async () => {
      const builder = createQueryBuilder({ data: { id: 'snap-1' }, error: null });

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'code_snapshots') {
          return builder;
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(builder.eq).toHaveBeenCalledWith('id', 'snap-1');
      expect(builder.eq).toHaveBeenCalledWith('session_id', TEST_SESSION_ID);
      expect(builder.single).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/sessions/:sessionId/submission
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/sessions/:sessionId/submission', () => {
    const baseUrl = `/api/sessions/${TEST_SESSION_ID}/submission`;

    it('returns the final submission', async () => {
      const mockSubmission = {
        id: 'sub-1',
        session_id: TEST_SESSION_ID,
        files: { 'main.ts': 'export {}' },
        submitted_at: '2026-01-15T09:30:00Z',
        total_files: 1,
        total_bytes: 11,
      };

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'final_submissions') {
          return createQueryBuilder({ data: mockSubmission, error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockSubmission);
    });

    it('returns 404 when no submission exists', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'final_submissions') {
          return createQueryBuilder({ data: null, error: { code: 'PGRST116', message: 'not found' } });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Submission not found' });
    });

    it('queries the final_submissions table by session_id', async () => {
      const builder = createQueryBuilder({ data: { id: 'sub-1' }, error: null });

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'final_submissions') {
          return builder;
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(mockSupabaseFrom).toHaveBeenCalledWith('final_submissions');
      expect(builder.eq).toHaveBeenCalledWith('session_id', TEST_SESSION_ID);
      expect(builder.single).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/sessions/:sessionId/timeline
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/sessions/:sessionId/timeline', () => {
    const baseUrl = `/api/sessions/${TEST_SESSION_ID}/timeline`;

    it('returns merged timeline sorted by timestamp', async () => {
      const mockEvents = [
        { event_type: 'command_run', detail: 'npm install', occurred_at: '2026-01-15T09:01:00Z' },
        { event_type: 'file_modify', detail: 'index.ts', occurred_at: '2026-01-15T09:03:00Z' },
        { event_type: 'command_run', detail: 'npm test', occurred_at: '2026-01-15T09:06:00Z' },
      ];

      const mockSnapshots = [
        { id: 10, snapshot_at: '2026-01-15T09:02:00Z' },
        { id: 20, snapshot_at: '2026-01-15T09:05:00Z' },
      ];

      let sessionActivityCallIndex = 0;
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'session_activity') {
          sessionActivityCallIndex++;
          return createQueryBuilder({ data: mockEvents, error: null });
        }
        if (table === 'code_snapshots') {
          return createQueryBuilder({ data: mockSnapshots, error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);

      const body = res.json();

      // Timeline should be sorted chronologically
      expect(body.timeline).toHaveLength(5); // 3 events + 2 snapshots
      expect(body.timeline[0]).toEqual({
        at: '2026-01-15T09:01:00Z',
        type: 'command_run',
        detail: 'npm install',
      });
      expect(body.timeline[1]).toEqual({
        at: '2026-01-15T09:02:00Z',
        type: 'snapshot',
        snapshot_id: 10,
      });
      expect(body.timeline[2]).toEqual({
        at: '2026-01-15T09:03:00Z',
        type: 'file_modify',
        detail: 'index.ts',
      });
      expect(body.timeline[3]).toEqual({
        at: '2026-01-15T09:05:00Z',
        type: 'snapshot',
        snapshot_id: 20,
      });
      expect(body.timeline[4]).toEqual({
        at: '2026-01-15T09:06:00Z',
        type: 'command_run',
        detail: 'npm test',
      });
    });

    it('returns correct summary stats including Claude stats', async () => {
      const mockEvents = [
        { event_type: 'command_run', detail: 'npm install', occurred_at: '2026-01-15T09:01:00Z' },
        { event_type: 'command_run', detail: 'npm test', occurred_at: '2026-01-15T09:02:00Z' },
        { event_type: 'file_create', detail: 'new.ts', occurred_at: '2026-01-15T09:03:00Z' },
        { event_type: 'file_modify', detail: 'index.ts', occurred_at: '2026-01-15T09:04:00Z' },
        { event_type: 'file_delete', detail: 'old.ts', occurred_at: '2026-01-15T09:05:00Z' },
        { event_type: 'file_move', detail: 'renamed.ts', occurred_at: '2026-01-15T09:06:00Z' },
        { event_type: 'claude_prompt', detail: 'write hello', occurred_at: '2026-01-15T09:07:00Z' },
        { event_type: 'claude_tool_use', detail: 'Write', occurred_at: '2026-01-15T09:07:30Z' },
        { event_type: 'claude_tool_use', detail: 'Read', occurred_at: '2026-01-15T09:07:45Z' },
        { event_type: 'claude_response', detail: 'Done!', occurred_at: '2026-01-15T09:08:00Z' },
        { event_type: 'focus_change', detail: null, occurred_at: '2026-01-15T09:09:00Z' },
      ];

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'session_activity') {
          return createQueryBuilder({ data: mockEvents, error: null });
        }
        if (table === 'code_snapshots') {
          return createQueryBuilder({ data: [], error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.total_commands).toBe(2); // 2 command_run events
      expect(body.total_file_changes).toBe(4); // file_create + file_modify + file_delete + file_move
      expect(body.total_claude_prompts).toBe(1); // 1 claude_prompt event
      expect(body.total_claude_tool_calls).toBe(2); // 2 claude_tool_use events
      expect(body.total_duration_seconds).toBeTypeOf('number');
      expect(body.total_duration_seconds).toBeGreaterThan(0);
    });

    it('returns empty timeline when no events or snapshots exist', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'session_activity') {
          return createQueryBuilder({ data: [], error: null });
        }
        if (table === 'code_snapshots') {
          return createQueryBuilder({ data: [], error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.timeline).toEqual([]);
      expect(body.total_commands).toBe(0);
      expect(body.total_file_changes).toBe(0);
      expect(body.total_duration_seconds).toBeTypeOf('number');
    });

    it('returns 500 when events query fails', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'session_activity') {
          return createQueryBuilder({ data: null, error: { message: 'db error' } });
        }
        if (table === 'code_snapshots') {
          return createQueryBuilder({ data: [], error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'Failed to query activity events' });
    });

    it('returns 500 when snapshots query fails', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'session_activity') {
          return createQueryBuilder({ data: [], error: null });
        }
        if (table === 'code_snapshots') {
          return createQueryBuilder({ data: null, error: { message: 'db error' } });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'Failed to query snapshots' });
    });

    it('handles null data arrays gracefully', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'session_activity') {
          return createQueryBuilder({ data: null, error: null });
        }
        if (table === 'code_snapshots') {
          return createQueryBuilder({ data: null, error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.timeline).toEqual([]);
      expect(body.total_commands).toBe(0);
      expect(body.total_file_changes).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/sessions/:sessionId/claude-transcripts
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/sessions/:sessionId/claude-transcripts', () => {
    const baseUrl = `/api/sessions/${TEST_SESSION_ID}/claude-transcripts`;

    it('returns transcript metadata list', async () => {
      const mockTranscripts = [
        { id: 1, claude_session_id: 'cs-1', total_prompts: 5, total_tool_calls: 10, total_tokens_in: 1000, total_tokens_out: 2000, collected_at: '2026-01-15T10:00:00Z' },
        { id: 2, claude_session_id: 'cs-2', total_prompts: 3, total_tool_calls: 7, total_tokens_in: 500, total_tokens_out: 1500, collected_at: '2026-01-15T10:05:00Z' },
      ];

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'claude_transcripts') {
          return createQueryBuilder({ data: mockTranscripts, error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ transcripts: mockTranscripts });
    });

    it('returns empty array when no transcripts exist', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'claude_transcripts') {
          return createQueryBuilder({ data: [], error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ transcripts: [] });
    });

    it('returns 500 when query fails', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'claude_transcripts') {
          return createQueryBuilder({ data: null, error: { message: 'db error' } });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'Failed to query Claude transcripts' });
    });

    it('selects only metadata columns (no transcript_jsonl)', async () => {
      const builder = createQueryBuilder({ data: [], error: null });

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'claude_transcripts') {
          return builder;
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(builder.select).toHaveBeenCalledWith(
        'id, claude_session_id, total_prompts, total_tool_calls, total_tokens_in, total_tokens_out, collected_at',
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/sessions/:sessionId/claude-transcripts/:transcriptId
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/sessions/:sessionId/claude-transcripts/:transcriptId', () => {
    const baseUrl = `/api/sessions/${TEST_SESSION_ID}/claude-transcripts/1`;

    it('returns full transcript with JSONL content', async () => {
      const mockTranscript = {
        id: 1,
        session_id: TEST_SESSION_ID,
        claude_session_id: 'cs-1',
        transcript_jsonl: '{"type":"human","content":"hello"}\n',
        total_prompts: 1,
        total_tool_calls: 0,
        total_tokens_in: 100,
        total_tokens_out: 200,
        collected_at: '2026-01-15T10:00:00Z',
      };

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'claude_transcripts') {
          return createQueryBuilder({ data: mockTranscript, error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockTranscript);
    });

    it('returns 404 when transcript does not exist', async () => {
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'claude_transcripts') {
          return createQueryBuilder({ data: null, error: { code: 'PGRST116', message: 'not found' } });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Transcript not found' });
    });

    it('filters by both transcriptId and sessionId', async () => {
      const builder = createQueryBuilder({ data: { id: 1 }, error: null });

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'claude_transcripts') {
          return builder;
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      await app.inject({
        method: 'GET',
        url: baseUrl,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(builder.eq).toHaveBeenCalledWith('id', '1');
      expect(builder.eq).toHaveBeenCalledWith('session_id', TEST_SESSION_ID);
      expect(builder.single).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Session ownership helper verifies correct sessionManager calls
  // ═══════════════════════════════════════════════════════════════════════════

  describe('session ownership helper', () => {
    it('calls sessionManager.getSession with the URL param sessionId', async () => {
      mockSupabaseFrom.mockImplementation(() =>
        createQueryBuilder({ data: [], error: null }),
      );

      app = await buildApp(sessionManager);

      await app.inject({
        method: 'GET',
        url: `/api/sessions/my-custom-session-id/snapshots`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(sessionManager.getSession).toHaveBeenCalledWith('my-custom-session-id');
    });

    it('works with stopped sessions (does not require running status)', async () => {
      sessionManager = createMockSessionManager(
        makeSession({ status: 'stopped', stoppedAt: new Date('2026-01-15T09:30:00Z') }),
      );

      mockSupabaseFrom.mockImplementation(() =>
        createQueryBuilder({ data: [], error: null }),
      );

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${TEST_SESSION_ID}/snapshots`,
        headers: { authorization: 'Bearer valid-token' },
      });

      // Should succeed — activity routes don't require running status
      expect(res.statusCode).toBe(200);
    });

    it('works with abandoned sessions', async () => {
      sessionManager = createMockSessionManager(
        makeSession({ status: 'abandoned' }),
      );

      mockSupabaseFrom.mockImplementation(() =>
        createQueryBuilder({ data: [], error: null }),
      );

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${TEST_SESSION_ID}/snapshots`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('works with timed_out sessions', async () => {
      sessionManager = createMockSessionManager(
        makeSession({ status: 'timed_out' }),
      );

      mockSupabaseFrom.mockImplementation(() =>
        createQueryBuilder({ data: [], error: null }),
      );

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${TEST_SESSION_ID}/activity`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Company membership authorization
  // ═══════════════════════════════════════════════════════════════════════════

  describe('company membership authorization', () => {
    const COMPANY_ID = 'company-123';
    const ASSIGNMENT_ID = 'assignment-456';

    it('grants access when user is a member of the company that owns the assignment', async () => {
      // Session belongs to a different user but has an assignmentId
      sessionManager = createMockSessionManager(
        makeSession({ userId: 'candidate-user', assignmentId: ASSIGNMENT_ID }),
      );

      // Company member requests access
      mockGetCompanyMembership.mockResolvedValue({ companyId: COMPANY_ID, role: 'admin' });

      // Supabase returns the assignment belonging to the company
      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'assessment_assignments') {
          return createQueryBuilder({ data: { id: ASSIGNMENT_ID }, error: null });
        }
        if (table === 'code_snapshots') {
          return createQueryBuilder({ data: [], error: null });
        }
        return createQueryBuilder({ data: [], error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${TEST_SESSION_ID}/snapshots`,
        headers: { authorization: 'Bearer company-member-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(mockGetCompanyMembership).toHaveBeenCalledWith('company-member-id');
    });

    it('denies access when user belongs to a different company', async () => {
      sessionManager = createMockSessionManager(
        makeSession({ userId: 'candidate-user', assignmentId: ASSIGNMENT_ID }),
      );

      // User is in a company, but assignment doesn't belong to that company
      mockGetCompanyMembership.mockResolvedValue({ companyId: 'other-company', role: 'member' });

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'assessment_assignments') {
          // No match — assignment doesn't belong to user's company
          return createQueryBuilder({ data: null, error: null });
        }
        return createQueryBuilder({ data: [], error: null });
      });

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${TEST_SESSION_ID}/snapshots`,
        headers: { authorization: 'Bearer company-member-token' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Not authorized for this session' });
    });

    it('denies access when session has no assignmentId', async () => {
      // Session without an assignment — company fallback should not fire
      sessionManager = createMockSessionManager(
        makeSession({ userId: 'candidate-user', assignmentId: null }),
      );

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${TEST_SESSION_ID}/snapshots`,
        headers: { authorization: 'Bearer company-member-token' },
      });

      expect(res.statusCode).toBe(403);
      // getCompanyMembership should never be called when there's no assignmentId
      expect(mockGetCompanyMembership).not.toHaveBeenCalled();
    });

    it('denies access when user has no company membership', async () => {
      sessionManager = createMockSessionManager(
        makeSession({ userId: 'candidate-user', assignmentId: ASSIGNMENT_ID }),
      );

      mockGetCompanyMembership.mockResolvedValue(null);

      app = await buildApp(sessionManager);

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${TEST_SESSION_ID}/snapshots`,
        headers: { authorization: 'Bearer company-member-token' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Not authorized for this session' });
    });

    it('company auth works across all activity routes', async () => {
      sessionManager = createMockSessionManager(
        makeSession({ userId: 'candidate-user', assignmentId: ASSIGNMENT_ID }),
      );

      mockGetCompanyMembership.mockResolvedValue({ companyId: COMPANY_ID, role: 'owner' });

      mockSupabaseFrom.mockImplementation((table: string) => {
        if (table === 'assessment_assignments') {
          return createQueryBuilder({ data: { id: ASSIGNMENT_ID }, error: null });
        }
        // Return valid data for every table
        if (table === 'session_activity') {
          return createQueryBuilder({ data: [], error: null, count: 0 });
        }
        if (table === 'code_snapshots') {
          return createQueryBuilder({ data: [], error: null });
        }
        if (table === 'claude_transcripts') {
          return createQueryBuilder({ data: [], error: null });
        }
        return createQueryBuilder({ data: null, error: null });
      });

      app = await buildApp(sessionManager);

      const routes = [
        `/api/sessions/${TEST_SESSION_ID}/activity`,
        `/api/sessions/${TEST_SESSION_ID}/snapshots`,
        `/api/sessions/${TEST_SESSION_ID}/timeline`,
        `/api/sessions/${TEST_SESSION_ID}/claude-transcripts`,
      ];

      for (const url of routes) {
        const res = await app.inject({
          method: 'GET',
          url,
          headers: { authorization: 'Bearer company-member-token' },
        });
        expect(res.statusCode, `Expected 200 for ${url}`).toBe(200);
      }
    });
  });
});
