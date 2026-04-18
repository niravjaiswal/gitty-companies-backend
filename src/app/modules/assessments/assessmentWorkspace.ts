import { posix } from 'node:path';

export interface AssessmentStageConfig {
  id?: string;
  name: string;
  objective?: string;
  instructionsMd: string;
}

export interface AssessmentAuthoringConfig {
  mode: 'single' | 'multi';
  stages: AssessmentStageConfig[];
  partCount?: number;
  examSpecifics?: string;
}

export const PART_COUNT_MIN = 1;
export const PART_COUNT_MAX = 26;
export const EXAM_SPECIFICS_MAX_LENGTH = 5000;

export interface StoredAssessmentWorkspace {
  files: Record<string, string>;
  entryFilePath: string;
  generatedAt: string | null;
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

  const partCount =
    typeof value.partCount === 'number' &&
    Number.isFinite(value.partCount) &&
    Number.isInteger(value.partCount) &&
    value.partCount >= PART_COUNT_MIN &&
    value.partCount <= PART_COUNT_MAX
      ? value.partCount
      : undefined;

  const rawExamSpecifics =
    typeof value.examSpecifics === 'string' ? value.examSpecifics.trim() : '';
  const examSpecifics = rawExamSpecifics
    ? rawExamSpecifics.slice(0, EXAM_SPECIFICS_MAX_LENGTH)
    : undefined;

  return {
    mode,
    stages,
    ...(partCount !== undefined ? { partCount } : {}),
    ...(examSpecifics !== undefined ? { examSpecifics } : {}),
  };
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

