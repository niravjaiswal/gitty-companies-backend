import { describe, expect, it } from 'vitest';
import { buildGenerationMetrics, chooseSkeleton } from '../generationQueue.js';
import type { RemixResult } from '../../../../remix/index.js';

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
