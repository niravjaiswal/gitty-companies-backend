import { describe, expect, it } from 'vitest';
import {
  chooseWorkspaceEntryFile,
  normalizeStoredWorkspace,
} from '../assessmentWorkspace.js';

describe('assessmentWorkspace helpers', () => {
  it('normalizes stored workspace files and rejects unsafe paths', () => {
    const workspace = normalizeStoredWorkspace(
      {
        'README.md': '# Hello',
        './src/app.ts': 'export const ok = true;',
        '../secrets.txt': 'nope',
        '/absolute/path.ts': 'nope',
        'src/../src/test.spec.ts': 'it("works", () => {})',
      },
      'src/app.ts',
      '2026-03-26T12:00:00.000Z',
    );

    expect(workspace.files).toEqual({
      'README.md': '# Hello',
      'src/app.ts': 'export const ok = true;',
      'src/test.spec.ts': 'it("works", () => {})',
    });
    expect(workspace.entryFilePath).toBe('src/app.ts');
    expect(workspace.generatedAt).toBe('2026-03-26T12:00:00.000Z');
  });

  it('prefers README as the workspace entry file', () => {
    expect(
      chooseWorkspaceEntryFile([
        'src/index.ts',
        'package.json',
        'README.md',
      ]),
    ).toBe('README.md');
  });
});
