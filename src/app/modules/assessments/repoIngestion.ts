import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

import {
  chooseWorkspaceEntryFile,
  normalizeWorkspaceRelativePath,
} from './assessmentWorkspace.js';

const execFileAsync = promisify(execFile);

export const REPO_HOST_ALLOWLIST = ['github.com', 'gitlab.com', 'bitbucket.org'] as const;

export const DEFAULT_REPO_INGEST_LIMITS: RepoIngestLimits = {
  maxStoredBytes: 5 * 1024 * 1024,
  maxFileCount: 2000,
  maxFileBytes: 1 * 1024 * 1024,
  cloneTimeoutMs: 60_000,
};

export const REPO_INGEST_ERROR_MESSAGES: Record<RepoIngestErrorCode, string> = {
  INVALID_URL: 'Repository URL is not a valid HTTPS URL.',
  DISALLOWED_HOST:
    'Only github.com, gitlab.com, and bitbucket.org repositories are supported.',
  INVALID_REF: 'Repository ref contains invalid characters.',
  CLONE_FAILED:
    'Could not clone the repository. Check that the URL is correct and the repo is public.',
  CLONE_TIMEOUT:
    'Clone timed out. The repository may be too large or the network was slow.',
  REPO_TOO_LARGE: 'Repository exceeds the size limit after filtering.',
  TOO_MANY_FILES: 'Repository has too many files after filtering.',
  NO_FILES: 'Repository contained no text files we could import.',
  INTERNAL: 'Internal error while importing the repository.',
};

const REF_PATTERN = /^[A-Za-z0-9._\-\/]+$/;

const IGNORED_PATH_PREFIXES = [
  '.git/',
  'node_modules/',
  'dist/',
  'build/',
  '.next/',
  '.turbo/',
  '.cache/',
  'coverage/',
  '.vercel/',
  '.svelte-kit/',
  '.nuxt/',
  '.parcel-cache/',
  '.output/',
];

const IGNORED_FILENAME_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_rsa.*$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /^\.npmrc$/i,
  /^\.yarnrc(\.yml)?$/i,
  /^\.DS_Store$/i,
  /^Thumbs\.db$/i,
];

export type RepoIngestDropReason =
  | 'too_large'
  | 'binary'
  | 'env_file'
  | 'ignored_path'
  | 'symlink'
  | 'unreadable';

export interface RepoIngestLimits {
  maxStoredBytes: number;
  maxFileCount: number;
  maxFileBytes: number;
  cloneTimeoutMs: number;
}

export interface RepoIngestMetadata {
  filesKept: number;
  filesDropped: number;
  bytesStored: number;
  droppedReasons: Partial<Record<RepoIngestDropReason, number>>;
}

export interface RepoIngestResult {
  files: Record<string, string>;
  entryFilePath: string;
  commitSha: string;
  metadata: RepoIngestMetadata;
}

export type RepoIngestErrorCode =
  | 'INVALID_URL'
  | 'DISALLOWED_HOST'
  | 'INVALID_REF'
  | 'CLONE_FAILED'
  | 'CLONE_TIMEOUT'
  | 'REPO_TOO_LARGE'
  | 'TOO_MANY_FILES'
  | 'NO_FILES'
  | 'INTERNAL';

export class RepoIngestError extends Error {
  readonly code: RepoIngestErrorCode;
  constructor(code: RepoIngestErrorCode, message?: string) {
    super(message ?? REPO_INGEST_ERROR_MESSAGES[code]);
    this.code = code;
    this.name = 'RepoIngestError';
  }
}

export interface GitOps {
  clone(url: string, ref: string | undefined, destDir: string, timeoutMs: number): Promise<void>;
  resolveHead(dir: string): Promise<string>;
}

export interface IngestRepoInput {
  url: string;
  ref?: string;
  limits?: Partial<RepoIngestLimits>;
  gitOps?: GitOps;
}

export function parseAndValidateRepoUrl(url: string): URL {
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new RepoIngestError('INVALID_URL');
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new RepoIngestError('INVALID_URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new RepoIngestError('INVALID_URL');
  }

  if (parsed.username || parsed.password) {
    throw new RepoIngestError('INVALID_URL');
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!REPO_HOST_ALLOWLIST.includes(host as (typeof REPO_HOST_ALLOWLIST)[number])) {
    throw new RepoIngestError('DISALLOWED_HOST');
  }

  if (parsed.pathname.includes('..') || parsed.pathname.includes('\0')) {
    throw new RepoIngestError('INVALID_URL');
  }

  return parsed;
}

export function validateRepoRef(ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined;
  const trimmed = ref.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > 200) {
    throw new RepoIngestError('INVALID_REF');
  }
  if (!REF_PATTERN.test(trimmed)) {
    throw new RepoIngestError('INVALID_REF');
  }
  return trimmed;
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 8192);
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function matchesIgnoredFilename(fileName: string): boolean {
  return IGNORED_FILENAME_PATTERNS.some((pattern) => pattern.test(fileName));
}

function matchesIgnoredPathPrefix(relPath: string): boolean {
  const posix = relPath.split(sep).join('/');
  return IGNORED_PATH_PREFIXES.some((prefix) => posix === prefix.slice(0, -1) || posix.startsWith(prefix));
}

function incrementDrop(metadata: RepoIngestMetadata, reason: RepoIngestDropReason): void {
  metadata.filesDropped += 1;
  metadata.droppedReasons[reason] = (metadata.droppedReasons[reason] ?? 0) + 1;
}

const defaultGitOps: GitOps = {
  async clone(url, ref, destDir, timeoutMs) {
    const args = ['clone', '--depth=1', '--single-branch'];
    if (ref) {
      args.push('--branch', ref);
    }
    args.push('--', url, destDir);

    try {
      await execFileAsync('git', args, {
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: 'echo',
        },
      });
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
      if (err.killed || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
        throw new RepoIngestError('CLONE_TIMEOUT');
      }
      throw new RepoIngestError('CLONE_FAILED');
    }
  },
  async resolveHead(dir) {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: dir,
        timeout: 10_000,
      });
      return stdout.trim();
    } catch {
      throw new RepoIngestError('INTERNAL', 'Failed to resolve commit SHA after clone.');
    }
  },
};

export async function ingestRepoFromDir(
  dir: string,
  limitsInput?: Partial<RepoIngestLimits>,
): Promise<Omit<RepoIngestResult, 'commitSha'>> {
  const limits: RepoIngestLimits = { ...DEFAULT_REPO_INGEST_LIMITS, ...limitsInput };
  const files: Record<string, string> = {};
  const metadata: RepoIngestMetadata = {
    filesKept: 0,
    filesDropped: 0,
    bytesStored: 0,
    droppedReasons: {},
  };

  let entries: Array<{ name: string; parentPath: string; isFile: boolean; isSymlink: boolean }>;
  try {
    const rawEntries = await readdir(dir, { recursive: true, withFileTypes: true });
    entries = rawEntries.map((entry) => ({
      name: entry.name,
      parentPath: (entry as { parentPath?: string; path?: string }).parentPath
        ?? (entry as { parentPath?: string; path?: string }).path
        ?? dir,
      isFile: entry.isFile(),
      isSymlink: entry.isSymbolicLink(),
    }));
  } catch (error) {
    throw new RepoIngestError(
      'INTERNAL',
      `Failed to walk cloned repo: ${(error as Error).message}`,
    );
  }

  for (const entry of entries) {
    if (entry.isSymlink) {
      incrementDrop(metadata, 'symlink');
      continue;
    }
    if (!entry.isFile) continue;

    const absPath = join(entry.parentPath, entry.name);
    const rawRelative = relative(dir, absPath);

    if (!rawRelative || rawRelative.startsWith('..')) {
      incrementDrop(metadata, 'ignored_path');
      continue;
    }

    if (matchesIgnoredPathPrefix(rawRelative)) {
      incrementDrop(metadata, 'ignored_path');
      continue;
    }

    if (matchesIgnoredFilename(entry.name)) {
      const reason: RepoIngestDropReason = /^\.env(\..*)?$/i.test(entry.name)
        ? 'env_file'
        : 'ignored_path';
      incrementDrop(metadata, reason);
      continue;
    }

    let fileStat;
    try {
      fileStat = await stat(absPath);
    } catch {
      incrementDrop(metadata, 'unreadable');
      continue;
    }

    if (fileStat.size > limits.maxFileBytes) {
      incrementDrop(metadata, 'too_large');
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(absPath);
    } catch {
      incrementDrop(metadata, 'unreadable');
      continue;
    }

    if (isBinaryBuffer(buffer)) {
      incrementDrop(metadata, 'binary');
      continue;
    }

    const normalizedPath = normalizeWorkspaceRelativePath(rawRelative);
    if (!normalizedPath) {
      incrementDrop(metadata, 'ignored_path');
      continue;
    }

    const content = buffer.toString('utf-8');
    const bytes = Buffer.byteLength(content, 'utf-8');

    if (metadata.filesKept + 1 > limits.maxFileCount) {
      throw new RepoIngestError('TOO_MANY_FILES');
    }
    if (metadata.bytesStored + bytes > limits.maxStoredBytes) {
      throw new RepoIngestError('REPO_TOO_LARGE');
    }

    files[normalizedPath] = content;
    metadata.filesKept += 1;
    metadata.bytesStored += bytes;
  }

  if (metadata.filesKept === 0) {
    throw new RepoIngestError('NO_FILES');
  }

  const orderedFiles = Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => left.localeCompare(right)),
  );

  return {
    files: orderedFiles,
    entryFilePath: chooseWorkspaceEntryFile(Object.keys(orderedFiles)),
    metadata,
  };
}

export async function ingestRepo(input: IngestRepoInput): Promise<RepoIngestResult> {
  const url = parseAndValidateRepoUrl(input.url);
  const ref = validateRepoRef(input.ref);
  const limits: RepoIngestLimits = { ...DEFAULT_REPO_INGEST_LIMITS, ...input.limits };
  const gitOps = input.gitOps ?? defaultGitOps;

  const tempDir = await mkdtemp(join(tmpdir(), 'gitty-byor-'));

  try {
    await gitOps.clone(url.toString(), ref, tempDir, limits.cloneTimeoutMs);
    const commitSha = await gitOps.resolveHead(tempDir);
    const { files, entryFilePath, metadata } = await ingestRepoFromDir(tempDir, limits);
    return { files, entryFilePath, commitSha, metadata };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
