import { describe, expect, it } from 'vitest';
import { computeComposite, correctnessScore } from '../gradingService.js';
import type { RunnerResult } from '../assessmentRunner.js';

function runner(overrides: Partial<RunnerResult>): RunnerResult {
  return {
    buildStatus: 'pass',
    testsPassed: null,
    testsTotal: null,
    durationMs: 1000,
    exitCodes: { npmCi: 0, tsc: 0, vitest: 0 },
    logsHead: { npmCi: '', tsc: '', vitest: '' },
    errorMessage: null,
    runnerVersion: 'runner-v1.0.0',
    submissionHash: 'hash',
    ...overrides,
  };
}

describe('correctnessScore', () => {
  it('returns 25 for build failures', () => {
    expect(correctnessScore(runner({ buildStatus: 'fail' }))).toBe(25);
  });

  it('returns null for runner errors (no signal)', () => {
    expect(correctnessScore(runner({ buildStatus: 'error' }))).toBeNull();
  });

  it('returns null for skipped (non-Node) submissions', () => {
    expect(correctnessScore(runner({ buildStatus: 'skipped' }))).toBeNull();
  });

  it('returns 70 for passing build with no test signal', () => {
    expect(correctnessScore(runner({ buildStatus: 'pass', testsTotal: null }))).toBe(70);
    expect(correctnessScore(runner({ buildStatus: 'pass', testsTotal: 0 }))).toBe(70);
  });

  it('scales linearly between 40 and 100 with test pass ratio', () => {
    expect(correctnessScore(runner({ buildStatus: 'pass', testsPassed: 0, testsTotal: 10 }))).toBe(40);
    expect(correctnessScore(runner({ buildStatus: 'pass', testsPassed: 5, testsTotal: 10 }))).toBe(70);
    expect(correctnessScore(runner({ buildStatus: 'pass', testsPassed: 10, testsTotal: 10 }))).toBe(100);
  });
});

describe('computeComposite — v2 weights when correctness present', () => {
  it('weights correctness at 0.4, code at 0.2, domain at 0.15, agent at 0.15, prompts at 0.1', () => {
    const { composite, weightsVersion } = computeComposite(
      {
        correctness: 100,
        codeQuality: 80,
        agentUsage: 60,
        promptingQuality: 40,
        industryKnowledge: 80,
      },
      'pass',
      10,
      10,
    );
    // 100*0.4 + 80*0.2 + 80*0.15 + 60*0.15 + 40*0.1 = 40 + 16 + 12 + 9 + 4 = 81
    expect(composite).toBe(81);
    expect(weightsVersion).toBe('v2');
  });

  it('uses v1 fallback weights when correctness is null', () => {
    const { composite, weightsVersion } = computeComposite(
      {
        correctness: null,
        codeQuality: 80,
        agentUsage: 60,
        promptingQuality: 40,
        industryKnowledge: 80,
      },
      'error',
      null,
      null,
    );
    // 80*0.4 + 60*0.2 + 40*0.2 + 80*0.2 = 32 + 12 + 8 + 16 = 68
    expect(composite).toBe(68);
    expect(weightsVersion).toBe('v1_fallback');
  });
});

describe('computeComposite — floor enforcement', () => {
  it('caps composite at 35 and forces strong_no on build_fail', () => {
    const outcome = computeComposite(
      {
        correctness: 25,
        codeQuality: 90,
        agentUsage: 90,
        promptingQuality: 90,
        industryKnowledge: 90,
      },
      'fail',
      null,
      null,
    );
    expect(outcome.composite).toBeLessThanOrEqual(35);
    expect(outcome.recommendation).toBe('strong_no');
  });

  it('caps composite at 45 and limits to no when tests are 0/N pass', () => {
    const outcome = computeComposite(
      {
        correctness: 40,
        codeQuality: 90,
        agentUsage: 90,
        promptingQuality: 90,
        industryKnowledge: 90,
      },
      'pass',
      0,
      10,
    );
    expect(outcome.composite).toBeLessThanOrEqual(45);
    expect(['no', 'strong_no']).toContain(outcome.recommendation);
  });

  it('does not floor when tests are absent (testsTotal=null)', () => {
    const outcome = computeComposite(
      {
        correctness: 70,
        codeQuality: 80,
        agentUsage: 80,
        promptingQuality: 80,
        industryKnowledge: 80,
      },
      'pass',
      null,
      null,
    );
    expect(outcome.composite).toBeGreaterThan(45);
  });
});
