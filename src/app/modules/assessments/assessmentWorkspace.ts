import { posix } from 'node:path';
import { extractSpec } from '../../../pipeline/stage1/extract-spec.js';
import { designScenario } from '../../../pipeline/stage2/design-scenario.js';
import { generateRepo } from '../../../pipeline/stage3/generate-repo.js';
import { validateRepo } from '../../../pipeline/stage4/validate-repo.js';
import { buildDemoWorkspace } from './demoWorkspace.js';

export interface AssessmentStageConfig {
  id?: string;
  name: string;
  objective?: string;
  instructionsMd: string;
}

export interface AssessmentAuthoringConfig {
  mode: 'single' | 'multi';
  stages: AssessmentStageConfig[];
}

export interface StoredAssessmentWorkspace {
  files: Record<string, string>;
  entryFilePath: string;
  generatedAt: string | null;
}

export interface AssessmentWorkspaceGenerationInput {
  title: string;
  summary: string;
  instructionsMd: string;
  sourceBrief: string;
  authoringConfig: AssessmentAuthoringConfig;
  generationMode?: 'live' | 'demo';
}

function normalizeWorkspaceRelativePath(filePath: string): string | null {
  const trimmed = filePath.trim().replace(/\\/g, '/');
  if (!trimmed) return null;

  const normalized = posix.normalize(trimmed).replace(/^(\.\/)+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('/') || normalized.startsWith('../')) {
    return null;
  }

  return normalized;
}

function normalizeWorkspaceFiles(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const entries = Object.entries(input as Record<string, unknown>)
    .map(([path, content]) => {
      const normalizedPath = normalizeWorkspaceRelativePath(path);
      if (!normalizedPath || typeof content !== 'string') {
        return null;
      }

      return [normalizedPath, content] as const;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null)
    .sort(([left], [right]) => left.localeCompare(right));

  return Object.fromEntries(entries);
}

export function chooseWorkspaceEntryFile(paths: Iterable<string>): string {
  const normalizedPaths = Array.from(
    new Set(
      Array.from(paths)
        .map((path) => normalizeWorkspaceRelativePath(path))
        .filter((path): path is string => Boolean(path)),
    ),
  ).sort((left, right) => left.localeCompare(right));

  if (normalizedPaths.length === 0) return '';

  const preferred = [
    'README.md',
    'README.mdx',
    'docs/README.md',
    'src/index.ts',
    'src/index.tsx',
    'src/main.ts',
    'src/main.tsx',
    'package.json',
  ];

  for (const candidate of preferred) {
    if (normalizedPaths.includes(candidate)) {
      return candidate;
    }
  }

  return normalizedPaths.find((path) => path.endsWith('.md')) ?? normalizedPaths[0];
}

export function normalizeAuthoringConfig(input: unknown): AssessmentAuthoringConfig {
  const value =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const mode = value.mode === 'multi' ? 'multi' : 'single';
  const rawStages = Array.isArray(value.stages) ? value.stages : [];

  const stages = rawStages
    .map((stage): AssessmentStageConfig | null => {
      if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return null;
      const draft = stage as Record<string, unknown>;
      const name = typeof draft.name === 'string' ? draft.name.trim() : '';
      const instructionsMd =
        typeof draft.instructionsMd === 'string' ? draft.instructionsMd.trim() : '';

      if (!name || !instructionsMd) return null;

      return {
        id: typeof draft.id === 'string' ? draft.id : undefined,
        name,
        objective: typeof draft.objective === 'string' ? draft.objective.trim() : '',
        instructionsMd,
      };
    })
    .filter((stage): stage is AssessmentStageConfig => stage !== null);

  return { mode, stages };
}

export function normalizeStoredWorkspace(
  filesInput: unknown,
  entryFileInput: unknown,
  generatedAtInput: unknown,
): StoredAssessmentWorkspace {
  const files = normalizeWorkspaceFiles(filesInput);
  const requestedEntryFile =
    typeof entryFileInput === 'string' ? normalizeWorkspaceRelativePath(entryFileInput) : null;
  const entryFilePath =
    requestedEntryFile && files[requestedEntryFile] !== undefined
      ? requestedEntryFile
      : chooseWorkspaceEntryFile(Object.keys(files));

  return {
    files,
    entryFilePath,
    generatedAt: typeof generatedAtInput === 'string' && generatedAtInput.trim()
      ? generatedAtInput
      : null,
  };
}

export function buildAssessmentGenerationPrompt(
  input: AssessmentWorkspaceGenerationInput,
): string {
  const sections: string[] = [
    'Generate a realistic technical assessment repository for a candidate.',
    `Assessment title:\n${input.title.trim() || 'Untitled assessment'}`,
  ];

  if (input.summary.trim()) {
    sections.push(`Internal hiring summary:\n${input.summary.trim()}`);
  }

  if (input.sourceBrief.trim()) {
    sections.push(`Private generation brief:\n${input.sourceBrief.trim()}`);
  }

  sections.push(`Candidate-facing instructions:\n${input.instructionsMd.trim()}`);
  sections.push(`Authoring mode: ${input.authoringConfig.mode}`);

  if (input.authoringConfig.stages.length > 0) {
    const stages = input.authoringConfig.stages
      .map((stage, index) => {
        const lines = [`Stage ${index + 1}: ${stage.name}`];
        if (stage.objective?.trim()) {
          lines.push(`Objective: ${stage.objective.trim()}`);
        }
        lines.push(`Instructions:\n${stage.instructionsMd.trim()}`);
        return lines.join('\n');
      })
      .join('\n\n');

    sections.push(`Internal stage breakdown:\n${stages}`);
  }

  sections.push(
    [
      'Repository requirements:',
      '- Generate a concrete, runnable starter project instead of a placeholder folder.',
      '- Always include package.json, a README, source files, and the test files that drive the assessment.',
      '- Generate starter application code and the test files that evaluate the candidate work.',
      '- The repository must be ready to open inside VS Code / code-server.',
      '- Keep the task aligned with the candidate-facing instructions and internal brief.',
      '- Prefer a focused project that can realistically be completed within the intended assessment window.',
      '- If the prompt does not explicitly name a stack, default to a small React + TypeScript + Vite project.',
      '- Do not generate only sandbox/bootstrap plumbing. Generate the actual assessment product code the candidate will work on.',
      '- The repo should feel like a real mini-product with named features, realistic flows, and existing code the candidate extends.',
      '- For frontend roles, prefer a creative UI product with concrete features, such as auth, stateful interactions, dashboards, games, collaboration, or workflow tools.',
      '- For Rust and systems roles, prefer a creative implementation such as a TUI, CLI, event processor, realtime service, parser, or systems utility rather than generic CRUD.',
      '- Include at least one intentionally incomplete feature and at least one bug or failing test that the candidate must resolve.',
    ].join('\n'),
  );

  return sections.join('\n\n');
}

function filesToRecord(files: Map<string, string>): Record<string, string> {
  return Object.fromEntries(
    [...files.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

export class AssessmentWorkspaceService {
  async generate(
    input: AssessmentWorkspaceGenerationInput,
  ): Promise<StoredAssessmentWorkspace> {
    if (input.generationMode === 'demo') {
      return await buildDemoWorkspace({
        title: input.title,
        instructionsMd: input.instructionsMd,
      });
    }

    const prompt = buildAssessmentGenerationPrompt(input);
    const spec = await extractSpec(prompt);
    const scenario = await designScenario(spec);
    const repo = await generateRepo(scenario, spec);
    const validated = await validateRepo(repo, scenario, spec);
    const files = filesToRecord(validated.files);

    if (Object.keys(files).length === 0) {
      throw new Error('Assessment workspace generation returned no files');
    }

    return {
      files,
      entryFilePath: chooseWorkspaceEntryFile(Object.keys(files)),
      generatedAt: new Date().toISOString(),
    };
  }
}
