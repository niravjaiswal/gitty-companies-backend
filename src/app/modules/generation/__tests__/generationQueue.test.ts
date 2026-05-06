import { describe, expect, it, vi } from 'vitest';
import { buildGenerationMetrics, chooseSkeleton, GenerationQueue } from '../generationQueue.js';
import type { RemixResult } from '../../../../remix/index.js';
import {
  REPO_INGEST_ERROR_MESSAGES,
  RepoIngestError,
  type RepoIngestResult,
} from '../../assessments/repoIngestion.js';

function makeRemixResult(overrides: {
  overallPass: boolean;
  errors?: string[];
  primaryVerified?: boolean;
  repair?: RemixResult['usage']['adapt']['repair'];
}): RemixResult {
  return {
    brief: {
      role_title: 'Engineer',
      company_name: 'Acme',
      domain: 'widgets',
      key_skills: ['typescript'],
      tech_stack: ['node'],
    },
    workspace: {
      files: {},
      scenario: { title: '', company_name: 'Acme', narrative: '' },
      tasks: [{ title: 't', description: 'd' }],
      rubric: [{ criterion: 'c', weight: 1 }],
    },
    validation: {
      tscPass: overrides.overallPass,
      vitestPass: overrides.overallPass,
      overallPass: overrides.overallPass,
      errors: overrides.errors ?? [],
    },
    instructionsMd: '',
    consistency: { pass: true, pathIssues: [], scriptIssues: [] },
    usage: {
      extract: { inputTokens: 0, outputTokens: 0, model: 'claude-sonnet-4-6' },
      adapt: {
        primary: {
          totalCostUsd: 0.4,
          inputTokens: 1000,
          outputTokens: 100,
          turns: 12,
          durationMs: 50_000,
          verified: overrides.primaryVerified ?? overrides.overallPass,
        },
        repair: overrides.repair ?? null,
      },
    },
  };
}

describe('chooseSkeleton', () => {
  it('chooses the full-stack skeleton for briefs mentioning API + React work', () => {
    expect(
      chooseSkeleton(
        'Build a customer support portal with a React frontend and Node API.',
      ),
    ).toBe('fullstack-support-hub');
  });

  it('chooses the data-processing skeleton for pipeline briefs', () => {
    expect(
      chooseSkeleton(
        'Own a streaming ETL pipeline that aggregates event metrics in batch windows.',
      ),
    ).toBe('data-pipeline-insights');
  });

  it('chooses the CLI skeleton for command-line tooling briefs', () => {
    expect(
      chooseSkeleton(
        'Create a CLI tool for operations teams to audit log files from the terminal.',
      ),
    ).toBe('ops-cli-audit');
  });

  it('chooses the React skeleton for frontend briefs', () => {
    expect(
      chooseSkeleton(
        'Work on a React dashboard with component state, filters, and Vite.',
      ),
    ).toBe('react-orders-board');
  });

  it('falls back to the REST API skeleton for generic backend briefs', () => {
    expect(
      chooseSkeleton(
        'Implement CRUD endpoints with Express, validation, and tests.',
      ),
    ).toBe('rest-api-express');
  });
});

interface CapturedUpdate {
  patch: Record<string, unknown>;
  id: unknown;
}

function makeFakeSupabase() {
  const updates: CapturedUpdate[] = [];
  const client = {
    from(_table: string) {
      return {
        update(patch: Record<string, unknown>) {
          return {
            eq(_col: string, val: unknown) {
              updates.push({ patch, id: val });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
  return { client, updates };
}

function makeSilentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => makeSilentLogger()),
    level: 'info',
  } as unknown as import('fastify').FastifyBaseLogger;
}

describe('GenerationQueue repo-source dispatch', () => {
  it('ingests a repo, persists the workspace, commit SHA, and metadata', async () => {
    const { client, updates } = makeFakeSupabase();
    const logger = makeSilentLogger();
    const fakeIngest = vi.fn().mockResolvedValue({
      files: { 'README.md': '# hi', 'src/index.ts': 'x' },
      entryFilePath: 'README.md',
      commitSha: 'deadbeef',
      metadata: { filesKept: 2, filesDropped: 0, bytesStored: 6, droppedReasons: {} },
    } satisfies RepoIngestResult);

    const queue = new GenerationQueue(
      client as unknown as import('@supabase/supabase-js').SupabaseClient,
      logger,
      { ingestRepo: fakeIngest },
    );

    await (queue as unknown as {
      processJob: (row: Record<string, unknown>) => Promise<void>;
    }).processJob({
      id: 'a1',
      source_type: 'repo',
      source_repo_url: 'https://github.com/acme/widget',
      source_repo_ref: 'main',
    });

    expect(fakeIngest).toHaveBeenCalledWith({
      url: 'https://github.com/acme/widget',
      ref: 'main',
    });
    expect(updates).toHaveLength(1);
    const { patch, id } = updates[0];
    expect(id).toBe('a1');
    expect(patch.generation_status).toBe('completed');
    expect(patch.generation_error).toBeNull();
    expect(patch.source_repo_commit_sha).toBe('deadbeef');
    expect(patch.workspace_entry_file).toBe('README.md');
    expect(patch.workspace_files).toEqual({ 'README.md': '# hi', 'src/index.ts': 'x' });
    expect(patch.source_repo_metadata).toMatchObject({ filesKept: 2 });
    expect(patch.generation_metrics).toBeNull();
  });

  it('maps RepoIngestError to the user-facing message and marks failed', async () => {
    const { client, updates } = makeFakeSupabase();
    const logger = makeSilentLogger();
    const fakeIngest = vi.fn().mockRejectedValue(new RepoIngestError('REPO_TOO_LARGE'));

    const queue = new GenerationQueue(
      client as unknown as import('@supabase/supabase-js').SupabaseClient,
      logger,
      { ingestRepo: fakeIngest },
    );

    await (queue as unknown as {
      processJob: (row: Record<string, unknown>) => Promise<void>;
    }).processJob({
      id: 'a2',
      source_type: 'repo',
      source_repo_url: 'https://github.com/acme/huge',
      source_repo_ref: 'main',
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].patch.generation_status).toBe('failed');
    expect(updates[0].patch.generation_error).toBe(
      REPO_INGEST_ERROR_MESSAGES.REPO_TOO_LARGE,
    );
    expect(updates[0].patch.workspace_files).toBeUndefined();
  });

  it('marks the job failed when source_repo_url is missing', async () => {
    const { client, updates } = makeFakeSupabase();
    const logger = makeSilentLogger();
    const fakeIngest = vi.fn();

    const queue = new GenerationQueue(
      client as unknown as import('@supabase/supabase-js').SupabaseClient,
      logger,
      { ingestRepo: fakeIngest },
    );

    await (queue as unknown as {
      processJob: (row: Record<string, unknown>) => Promise<void>;
    }).processJob({
      id: 'a3',
      source_type: 'repo',
      source_repo_url: null,
    });

    expect(fakeIngest).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.generation_status).toBe('failed');
    expect(String(updates[0].patch.generation_error)).toMatch(/URL is missing/i);
  });

  it('passes ref undefined when source_repo_ref is blank', async () => {
    const { client } = makeFakeSupabase();
    const logger = makeSilentLogger();
    const fakeIngest = vi.fn().mockResolvedValue({
      files: { 'README.md': '#' },
      entryFilePath: 'README.md',
      commitSha: 'abc',
      metadata: { filesKept: 1, filesDropped: 0, bytesStored: 1, droppedReasons: {} },
    } satisfies RepoIngestResult);

    const queue = new GenerationQueue(
      client as unknown as import('@supabase/supabase-js').SupabaseClient,
      logger,
      { ingestRepo: fakeIngest },
    );

    await (queue as unknown as {
      processJob: (row: Record<string, unknown>) => Promise<void>;
    }).processJob({
      id: 'a4',
      source_type: 'repo',
      source_repo_url: 'https://github.com/acme/widget',
      source_repo_ref: '   ',
    });

    expect(fakeIngest).toHaveBeenCalledWith({
      url: 'https://github.com/acme/widget',
      ref: undefined,
    });
  });
});

describe('buildGenerationMetrics', () => {
  it('records primary-only metrics when the first pass verifies', () => {
    const result = makeRemixResult({ overallPass: true });
    const metrics = buildGenerationMetrics('rest-api-express', result);

    expect(metrics.skeleton_id).toBe('rest-api-express');
    expect(metrics.final_verified).toBe(true);
    expect(metrics.primary.verified).toBe(true);
    expect(metrics.primary.cost_usd).toBe(0.4);
    expect(metrics.primary.turns).toBe(12);
    expect(metrics.repair).toBeNull();
    expect(metrics.tsc_output_head).toBe('');
    expect(metrics.vitest_output_head).toBe('');
  });

  it('records a repair pass and captures truncated error heads on failure', () => {
    const longTsc = 'TS2322: '.repeat(200);
    const result = makeRemixResult({
      overallPass: false,
      errors: [`tsc:\n${longTsc}`, 'vitest:\nAssertion failed in foo.test.ts'],
      primaryVerified: false,
      repair: {
        totalCostUsd: 0.2,
        inputTokens: 500,
        outputTokens: 40,
        turns: 6,
        durationMs: 20_000,
        verified: false,
      },
    });
    const metrics = buildGenerationMetrics('fullstack-support-hub', result);

    expect(metrics.final_verified).toBe(false);
    expect(metrics.primary.verified).toBe(false);
    expect(metrics.repair).not.toBeNull();
    expect(metrics.repair?.turns).toBe(6);
    expect(metrics.repair?.verified).toBe(false);
    expect(metrics.tsc_output_head.length).toBeLessThanOrEqual(500);
    expect(metrics.tsc_output_head.startsWith('TS2322:')).toBe(true);
    expect(metrics.vitest_output_head).toBe('Assertion failed in foo.test.ts');
  });
});
