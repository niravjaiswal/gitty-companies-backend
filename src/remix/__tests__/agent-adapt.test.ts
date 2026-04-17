import { describe, expect, it } from 'vitest';
import { truncateOutput } from '../agent-adapt.js';

describe('truncateOutput', () => {
  it('returns input unchanged when within the byte cap', () => {
    const input = 'a'.repeat(100);
    expect(truncateOutput(input, 200)).toBe(input);
  });

  it('truncates the tail and appends a marker noting removed chars', () => {
    const input = 'a'.repeat(1_000);
    const result = truncateOutput(input, 100);

    expect(result.startsWith('a'.repeat(100))).toBe(true);
    expect(result).toContain('[truncated 900 more chars]');
    expect(result.length).toBeLessThan(input.length);
  });

  it('defaults to the 5KB cap when no explicit limit is passed', () => {
    const input = 'x'.repeat(10_000);
    const result = truncateOutput(input);

    expect(result.startsWith('x'.repeat(5_000))).toBe(true);
    expect(result).toContain('[truncated 5000 more chars]');
  });
});
