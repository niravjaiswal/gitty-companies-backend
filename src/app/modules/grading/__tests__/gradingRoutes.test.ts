import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gradingRoutes } from '../gradingRoutes.js';
import { GradingService } from '../gradingService.js';

vi.mock('../../../infra/auth/auth.js', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'company-user-id', email: 'company@test.com' };
  },
}));

const mockGetCompanyMembership = vi.fn();
vi.mock('../../../infra/auth/companyAuth.js', () => ({
  getCompanyMembership: (...args: any[]) => mockGetCompanyMembership(...args),
}));

function createQueryBuilder(resolveValue: { data: any; error: any }) {
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
  builder.then = (resolve: any) => resolve(resolveValue);
  return builder;
}

let mockSupabaseFrom: any;
vi.mock('../../../infra/db/supabase.js', () => ({
  getSupabaseAdmin: () => ({
    from: (...args: any[]) => mockSupabaseFrom(...args),
  }),
}));

vi.mock('../gradingService.js', () => ({
  GradingService: vi.fn().mockImplementation(function () {
    return {
      getGrade: vi.fn().mockResolvedValue({
        sessionId: 'session-123',
        codeQuality: { score: 80, summary: 'Solid', flags: [] },
        agentUsage: { score: 70, summary: 'Useful', flags: [] },
        promptingQuality: { score: 75, summary: 'Clear', flags: [] },
        industryKnowledge: { score: 78, summary: 'Practical', flags: [] },
        compositeScore: 77,
        recommendation: 'maybe',
        gradedAt: '2026-01-15T10:00:00.000Z',
        modelId: 'test-model',
      }),
      gradeSession: vi.fn().mockResolvedValue({
        sessionId: 'session-123',
        codeQuality: { score: 80, summary: 'Solid', flags: [] },
        agentUsage: { score: 70, summary: 'Useful', flags: [] },
        promptingQuality: { score: 75, summary: 'Clear', flags: [] },
        industryKnowledge: { score: 78, summary: 'Practical', flags: [] },
        compositeScore: 77,
        recommendation: 'maybe',
        gradedAt: '2026-01-15T10:00:00.000Z',
        modelId: 'test-model',
      }),
    };
  }),
}));

const SESSION_ID = 'session-123';
const ASSIGNMENT_ID = 'assignment-456';
const COMPANY_ID = 'company-abc';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const gradingQueue = {
    enqueue: vi.fn().mockResolvedValue(undefined),
    getJobStatus: vi.fn().mockResolvedValue(null),
  } as any;
  const sandboxService = {} as any;
  await app.register(gradingRoutes, { gradingQueue, sandboxService });
  await app.ready();
  return app;
}

describe('gradingRoutes authorization', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCompanyMembership.mockResolvedValue({ companyId: COMPANY_ID, role: 'admin' });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('returns 403 for GET when the session assignment is outside the requester company', async () => {
    mockSupabaseFrom = vi.fn((table: string) => {
      if (table === 'sessions') {
        return createQueryBuilder({
          data: { id: SESSION_ID, assignment_id: ASSIGNMENT_ID },
          error: null,
        });
      }
      if (table === 'assessment_assignments') {
        return createQueryBuilder({ data: null, error: null });
      }
      return createQueryBuilder({ data: null, error: null });
    });

    app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${SESSION_ID}/grade`,
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Not authorized for this session' });
    expect(GradingService).not.toHaveBeenCalled();
  });

  it('returns 403 for POST when the session assignment is outside the requester company', async () => {
    mockSupabaseFrom = vi.fn((table: string) => {
      if (table === 'sessions') {
        return createQueryBuilder({
          data: { id: SESSION_ID, assignment_id: ASSIGNMENT_ID },
          error: null,
        });
      }
      if (table === 'assessment_assignments') {
        return createQueryBuilder({ data: null, error: null });
      }
      return createQueryBuilder({ data: null, error: null });
    });

    app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${SESSION_ID}/grade`,
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Not authorized for this session' });
    expect(GradingService).not.toHaveBeenCalled();
  });

  it('allows grading routes when the session assignment belongs to the requester company', async () => {
    const assignmentBuilder = createQueryBuilder({
      data: { id: ASSIGNMENT_ID },
      error: null,
    });

    mockSupabaseFrom = vi.fn((table: string) => {
      if (table === 'sessions') {
        return createQueryBuilder({
          data: { id: SESSION_ID, assignment_id: ASSIGNMENT_ID },
          error: null,
        });
      }
      if (table === 'assessment_assignments') {
        return assignmentBuilder;
      }
      return createQueryBuilder({ data: null, error: null });
    });

    app = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${SESSION_ID}/grade`,
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(res.statusCode).toBe(200);
    expect(assignmentBuilder.eq).toHaveBeenCalledWith('id', ASSIGNMENT_ID);
    expect(assignmentBuilder.eq).toHaveBeenCalledWith('company_id', COMPANY_ID);
    expect(GradingService).toHaveBeenCalledOnce();
  });
});
