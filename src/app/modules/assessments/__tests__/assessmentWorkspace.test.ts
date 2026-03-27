import { describe, expect, it } from 'vitest';
import {
  buildAssessmentGenerationPrompt,
  chooseWorkspaceEntryFile,
  normalizeAuthoringConfig,
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

  it('builds a structured generation prompt from the authoring brief', () => {
    const authoringConfig = normalizeAuthoringConfig({
      mode: 'multi',
      stages: [
        {
          id: 'stage-1',
          name: 'Debug API',
          objective: 'Find and fix regressions',
          instructionsMd: 'Repair the failing endpoint and keep tests green.',
        },
      ],
    });

    const prompt = buildAssessmentGenerationPrompt({
      title: 'Senior Backend Engineer',
      summary: 'Evaluate debugging and test ownership.',
      instructionsMd: 'Candidates should work in the provided repository.',
      sourceBrief: 'Create a realistic Express and Vitest exercise.',
      authoringConfig,
    });

    expect(prompt).toContain('Senior Backend Engineer');
    expect(prompt).toContain('Evaluate debugging and test ownership.');
    expect(prompt).toContain('Create a realistic Express and Vitest exercise.');
    expect(prompt).toContain('Stage 1: Debug API');
    expect(prompt).toContain('Repair the failing endpoint and keep tests green.');
    expect(prompt).toContain('Generate starter application code and the test files');
  });
});
