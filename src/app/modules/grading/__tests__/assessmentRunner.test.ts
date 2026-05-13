import { describe, expect, it } from 'vitest';
import { hashSubmission, parseVitestJson } from '../assessmentRunner.js';

describe('hashSubmission', () => {
  it('is order-independent for the file map', () => {
    const a = hashSubmission({ 'a.ts': 'x', 'b.ts': 'y' });
    const b = hashSubmission({ 'b.ts': 'y', 'a.ts': 'x' });
    expect(a).toBe(b);
  });

  it('changes when any file content changes', () => {
    const before = hashSubmission({ 'a.ts': 'x' });
    const after = hashSubmission({ 'a.ts': 'y' });
    expect(after).not.toBe(before);
  });

  it('changes when any file path changes', () => {
    const before = hashSubmission({ 'a.ts': 'x' });
    const after = hashSubmission({ 'b.ts': 'x' });
    expect(after).not.toBe(before);
  });
});

describe('parseVitestJson', () => {
  it('extracts numPassedTests and numTotalTests from clean JSON', () => {
    const stdout = JSON.stringify({
      numTotalTests: 18,
      numPassedTests: 14,
      numFailedTests: 4,
    });
    expect(parseVitestJson(stdout)).toEqual({ passed: 14, total: 18 });
  });

  it('handles JSON preceded by stdout noise', () => {
    const stdout = `> vitest run --reporter=json\n\n${JSON.stringify({
      numTotalTests: 5,
      numPassedTests: 5,
      numFailedTests: 0,
    })}\n`;
    expect(parseVitestJson(stdout)).toEqual({ passed: 5, total: 5 });
  });

  it('returns null when output is not parseable', () => {
    expect(parseVitestJson('no json here')).toBeNull();
  });

  it('returns null when expected fields are missing', () => {
    const stdout = JSON.stringify({ somethingElse: true });
    expect(parseVitestJson(stdout)).toBeNull();
  });
});
