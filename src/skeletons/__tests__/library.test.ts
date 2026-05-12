import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadSkeleton } from '../loader.js';
import { RepoExecutor } from '../../validation/executor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKELETONS_DIR = join(__dirname, '..');

async function listSkeletonIds(): Promise<string[]> {
  const entries = await readdir(SKELETONS_DIR, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('__'))
    .map((entry) => entry.name);

  const ids: string[] = [];
  for (const name of candidates) {
    try {
      await access(join(SKELETONS_DIR, name, 'skeleton.json'));
      ids.push(name);
    } catch {
      // Sibling directories (e.g. scoring/) are not skeletons; skip them.
    }
  }
  return ids.sort();
}

describe('skeleton library', () => {
  it('loads every skeleton directory', async () => {
    const ids = await listSkeletonIds();
    expect(ids.length).toBeGreaterThanOrEqual(6);

    for (const id of ids) {
      const loaded = await loadSkeleton(id);
      expect(loaded.skeleton.name).toBe(id);
      expect(loaded.manifest.files.length).toBeGreaterThan(0);
    }
  });

  it('includes both provided files and candidate work in every manifest', async () => {
    const ids = await listSkeletonIds();

    for (const id of ids) {
      const loaded = await loadSkeleton(id);
      const roles = new Set(loaded.manifest.files.map((entry) => entry.role));
      expect(roles.has('provided')).toBe(true);
      expect(roles.has('candidate') || roles.has('partial')).toBe(true);
    }
  });

  it(
    'validates each skeleton against the repo contract',
    async () => {
      const ids = await listSkeletonIds();

      for (const id of ids) {
        const loaded = await loadSkeleton(id);
        const executor = await RepoExecutor.create();

        try {
          await executor.writeFiles(new Map(Object.entries(loaded.files)));

          const install = await executor.npmInstall();
          expect(install.exitCode, `${id}: npm install failed\n${install.stderr}`).toBe(0);

          const tsc = await executor.tscCheck();
          expect(tsc.exitCode, `${id}: tsc failed\n${tsc.stdout}\n${tsc.stderr}`).toBe(0);

          const vitest = await executor.vitestRun();
          expect(vitest.exitCode, `${id}: vitest failed\n${vitest.stdout}\n${vitest.stderr}`).toBe(0);
        } finally {
          await executor.cleanup();
        }
      }
    },
    240_000,
  );
});
