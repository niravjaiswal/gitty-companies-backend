import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  DEFAULT_REPO_INGEST_LIMITS,
  REPO_HOST_ALLOWLIST,
  RepoIngestError,
  ingestRepo,
  ingestRepoFromDir,
  parseAndValidateRepoUrl,
  validateRepoRef,
  type GitOps,
} from '../repoIngestion.js';

async function makeFixture(
  files: Record<string, Buffer | string>,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'byor-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = join(dir, relPath);
    const parent = absPath.slice(0, absPath.lastIndexOf('/'));
    await mkdir(parent, { recursive: true });
    await writeFile(
      absPath,
      typeof content === 'string' ? Buffer.from(content, 'utf-8') : content,
    );
  }
  return dir;
}

describe('parseAndValidateRepoUrl', () => {
  it('accepts https URLs on allowlisted hosts', () => {
    for (const host of REPO_HOST_ALLOWLIST) {
      const parsed = parseAndValidateRepoUrl(`https://${host}/acme/widget`);
      expect(parsed.hostname).toBe(host);
    }
  });

  it('strips www. prefix when checking host allowlist', () => {
    const parsed = parseAndValidateRepoUrl('https://www.github.com/acme/widget');
    expect(parsed.hostname).toBe('www.github.com');
  });

  it('accepts .git suffix in URL', () => {
    const parsed = parseAndValidateRepoUrl('https://github.com/acme/widget.git');
    expect(parsed.pathname).toBe('/acme/widget.git');
  });

  it('rejects empty or non-string input', () => {
    expect(() => parseAndValidateRepoUrl('')).toThrow(RepoIngestError);
    expect(() => parseAndValidateRepoUrl('   ')).toThrow(RepoIngestError);
    // @ts-expect-error — testing runtime guard
    expect(() => parseAndValidateRepoUrl(undefined)).toThrow(RepoIngestError);
  });

  it('rejects non-https protocols', () => {
    expect(() => parseAndValidateRepoUrl('http://github.com/acme/widget'))
      .toThrowError(expect.objectContaining({ code: 'INVALID_URL' }));
    expect(() =>
      parseAndValidateRepoUrl('git@github.com:acme/widget.git'),
    ).toThrow();
    expect(() => parseAndValidateRepoUrl('file:///tmp/repo')).toThrow();
    expect(() => parseAndValidateRepoUrl('ssh://github.com/acme/widget')).toThrow();
  });

  it('rejects URLs with embedded credentials', () => {
    expect(() =>
      parseAndValidateRepoUrl('https://user:token@github.com/acme/widget'),
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_URL' }),
    );
  });

  it('rejects hosts outside the allowlist', () => {
    expect(() => parseAndValidateRepoUrl('https://evil.example.com/acme/widget'))
      .toThrowError(expect.objectContaining({ code: 'DISALLOWED_HOST' }));
    expect(() => parseAndValidateRepoUrl('https://githubusercontent.com/acme'))
      .toThrowError(expect.objectContaining({ code: 'DISALLOWED_HOST' }));
  });

  it('normalizes path traversal via the URL constructor', () => {
    // new URL() normalizes "/../etc/passwd" to "/etc/passwd", which lands inside
    // an allowed host and is a safe pathname. The defensive '..' check only trips
    // if percent-encoded sequences reintroduce traversal — there's no general-case
    // exploit, but we verify the sanitized pathname is what git receives.
    const parsed = parseAndValidateRepoUrl('https://github.com/../etc/passwd');
    expect(parsed.pathname).not.toContain('..');
  });

  it('rejects malformed URLs', () => {
    expect(() => parseAndValidateRepoUrl('not a url')).toThrow(RepoIngestError);
    expect(() => parseAndValidateRepoUrl('https://')).toThrow(RepoIngestError);
  });
});

describe('validateRepoRef', () => {
  it('returns undefined for undefined or empty input', () => {
    expect(validateRepoRef(undefined)).toBeUndefined();
    expect(validateRepoRef('')).toBeUndefined();
    expect(validateRepoRef('   ')).toBeUndefined();
  });

  it('accepts typical git refs', () => {
    expect(validateRepoRef('main')).toBe('main');
    expect(validateRepoRef('release/v1.2.3')).toBe('release/v1.2.3');
    expect(validateRepoRef('feature_branch-01')).toBe('feature_branch-01');
    expect(validateRepoRef('v1.0.0')).toBe('v1.0.0');
  });

  it('rejects refs with shell metacharacters', () => {
    expect(() => validateRepoRef('; rm -rf /')).toThrowError(
      expect.objectContaining({ code: 'INVALID_REF' }),
    );
    expect(() => validateRepoRef('main && echo pwn')).toThrow();
    expect(() => validateRepoRef('`whoami`')).toThrow();
    expect(() => validateRepoRef('$(echo x)')).toThrow();
  });

  it('rejects refs longer than 200 characters', () => {
    expect(() => validateRepoRef('a'.repeat(201))).toThrow();
  });
});

describe('ingestRepoFromDir', () => {
  let fixtureDir: string | null = null;

  afterEach(async () => {
    if (fixtureDir) {
      await rm(fixtureDir, { recursive: true, force: true });
      fixtureDir = null;
    }
  });

  it('returns text files and skips node_modules / .git / dist', async () => {
    fixtureDir = await makeFixture({
      'README.md': '# hi',
      'src/index.ts': 'export const x = 1;',
      'src/util.ts': 'export const y = 2;',
      'node_modules/foo/index.js': 'module.exports = {};',
      '.git/config': '[core]',
      'dist/index.js': 'bundled',
      'package.json': '{"name":"fixture"}',
    });

    const result = await ingestRepoFromDir(fixtureDir);

    expect(Object.keys(result.files).sort()).toEqual([
      'README.md',
      'package.json',
      'src/index.ts',
      'src/util.ts',
    ]);
    expect(result.entryFilePath).toBe('README.md');
    expect(result.metadata.filesKept).toBe(4);
    expect(result.metadata.droppedReasons.ignored_path ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('strips .env files and counts them under env_file reason', async () => {
    fixtureDir = await makeFixture({
      'README.md': '# hi',
      '.env': 'SECRET=123',
      '.env.local': 'TOKEN=abc',
      'config/.env.production': 'DB=pg',
    });

    const result = await ingestRepoFromDir(fixtureDir);

    expect(result.files).toEqual({ 'README.md': '# hi' });
    expect(result.metadata.droppedReasons.env_file).toBe(3);
  });

  it('drops binary files via null-byte sniff', async () => {
    const binary = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]), Buffer.alloc(16, 0xff)]);
    fixtureDir = await makeFixture({
      'README.md': '# hi',
      'assets/icon.png': binary,
    });

    const result = await ingestRepoFromDir(fixtureDir);

    expect(result.files).toEqual({ 'README.md': '# hi' });
    expect(result.metadata.droppedReasons.binary).toBe(1);
  });

  it('drops individual files exceeding maxFileBytes', async () => {
    fixtureDir = await makeFixture({
      'README.md': '# hi',
      'src/big.ts': 'x'.repeat(2000),
    });

    const result = await ingestRepoFromDir(fixtureDir, { maxFileBytes: 500 });

    expect(Object.keys(result.files)).toEqual(['README.md']);
    expect(result.metadata.droppedReasons.too_large).toBe(1);
  });

  it('throws TOO_MANY_FILES when count exceeds limit', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i += 1) {
      files[`src/file${i}.ts`] = `export const f${i} = ${i};`;
    }
    fixtureDir = await makeFixture(files);

    await expect(ingestRepoFromDir(fixtureDir, { maxFileCount: 5 })).rejects.toThrowError(
      expect.objectContaining({ code: 'TOO_MANY_FILES' }),
    );
  });

  it('throws REPO_TOO_LARGE when total stored bytes exceed limit', async () => {
    fixtureDir = await makeFixture({
      'a.ts': 'x'.repeat(400),
      'b.ts': 'y'.repeat(400),
      'c.ts': 'z'.repeat(400),
    });

    await expect(ingestRepoFromDir(fixtureDir, { maxStoredBytes: 500 })).rejects.toThrowError(
      expect.objectContaining({ code: 'REPO_TOO_LARGE' }),
    );
  });

  it('throws NO_FILES when nothing survives filtering', async () => {
    fixtureDir = await makeFixture({
      '.env': 'SECRET=1',
      'node_modules/foo.js': 'x',
    });

    await expect(ingestRepoFromDir(fixtureDir)).rejects.toThrowError(
      expect.objectContaining({ code: 'NO_FILES' }),
    );
  });
});

describe('ingestRepo', () => {
  let tempDirsCreated: string[] = [];
  const makeFakeGitOps = (
    writeFilesInto: Record<string, string> | ((dir: string) => Promise<void>) | Error,
    commitSha = 'abc123',
  ): GitOps => ({
    async clone(_url, _ref, dest) {
      if (writeFilesInto instanceof Error) {
        throw writeFilesInto;
      }
      tempDirsCreated.push(dest);
      if (typeof writeFilesInto === 'function') {
        await writeFilesInto(dest);
      } else {
        for (const [relPath, content] of Object.entries(writeFilesInto)) {
          const absPath = join(dest, relPath);
          const parent = absPath.slice(0, absPath.lastIndexOf('/'));
          await mkdir(parent, { recursive: true });
          await writeFile(absPath, content, 'utf-8');
        }
      }
    },
    async resolveHead() {
      return commitSha;
    },
  });

  beforeEach(() => {
    tempDirsCreated = [];
  });

  afterEach(async () => {
    for (const dir of tempDirsCreated) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('clones, ingests, and returns commit sha + entry file', async () => {
    const gitOps = makeFakeGitOps(
      {
        'README.md': '# Project',
        'src/index.ts': 'export const ok = true;',
      },
      'deadbeef',
    );

    const result = await ingestRepo({
      url: 'https://github.com/acme/widget',
      gitOps,
    });

    expect(result.commitSha).toBe('deadbeef');
    expect(result.entryFilePath).toBe('README.md');
    expect(result.files['src/index.ts']).toBe('export const ok = true;');
    expect(result.metadata.filesKept).toBe(2);
  });

  it('rejects INVALID_URL before attempting clone', async () => {
    const gitOps = makeFakeGitOps({});
    const spy = vi.spyOn(gitOps, 'clone');

    await expect(
      ingestRepo({ url: 'not-a-url', gitOps }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'INVALID_URL' }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects DISALLOWED_HOST before attempting clone', async () => {
    const gitOps = makeFakeGitOps({});
    const spy = vi.spyOn(gitOps, 'clone');

    await expect(
      ingestRepo({ url: 'https://evil.example.com/acme/widget', gitOps }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'DISALLOWED_HOST' }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('surfaces CLONE_FAILED when git clone throws', async () => {
    const gitOps = makeFakeGitOps(new RepoIngestError('CLONE_FAILED'));

    await expect(
      ingestRepo({ url: 'https://github.com/acme/widget', gitOps }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'CLONE_FAILED' }));
  });

  it('cleans up the temp dir even when ingestion throws', async () => {
    const gitOps = makeFakeGitOps({ 'node_modules/only.js': 'ignored' });

    await expect(
      ingestRepo({ url: 'https://github.com/acme/widget', gitOps }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'NO_FILES' }));

    for (const dir of tempDirsCreated) {
      await expect(stat(dir)).rejects.toThrow(/ENOENT/);
    }
    tempDirsCreated = [];
  });

  it('cleans up the temp dir on success', async () => {
    const gitOps = makeFakeGitOps({ 'README.md': '# ok' });

    await ingestRepo({ url: 'https://github.com/acme/widget', gitOps });

    for (const dir of tempDirsCreated) {
      await expect(stat(dir)).rejects.toThrow(/ENOENT/);
    }
    tempDirsCreated = [];
  });
});

describe('DEFAULT_REPO_INGEST_LIMITS', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_REPO_INGEST_LIMITS.maxStoredBytes).toBe(5 * 1024 * 1024);
    expect(DEFAULT_REPO_INGEST_LIMITS.maxFileCount).toBe(2000);
    expect(DEFAULT_REPO_INGEST_LIMITS.maxFileBytes).toBe(1 * 1024 * 1024);
  });
});

// Tiny sanity that the walker actually discovers nested files regardless of OS path separator.
describe('ingestRepoFromDir — cross-platform', () => {
  it('discovers nested directories recursively', async () => {
    const fixtureDir = await makeFixture({
      'a/b/c/deep.ts': 'export const z = 42;',
    });
    try {
      const result = await ingestRepoFromDir(fixtureDir);
      expect(result.files['a/b/c/deep.ts']).toBe('export const z = 42;');
      const entries = await readdir(fixtureDir, { recursive: true });
      expect(entries.length).toBeGreaterThan(0);
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
