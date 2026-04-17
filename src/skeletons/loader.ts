import { readFile, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { SkeletonSchema, ManifestSchema } from "./types.js";
import type { LoadedSkeleton, Skeleton } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load a skeleton by id from the skeletons directory.
 * Reads skeleton.json, manifest.json, and all files listed in the manifest.
 */
export async function loadSkeleton(id: string): Promise<LoadedSkeleton> {
  const skeletonDir = join(__dirname, id);

  try {
    await access(skeletonDir);
  } catch {
    throw new Error(`Skeleton not found: "${id}" (looked in ${skeletonDir})`);
  }

  // Read and validate skeleton.json
  const skeletonPath = join(skeletonDir, "skeleton.json");
  let skeletonRaw: string;
  try {
    skeletonRaw = await readFile(skeletonPath, "utf-8");
  } catch {
    throw new Error(`Missing skeleton.json in skeleton "${id}"`);
  }

  const skeletonResult = SkeletonSchema.safeParse(JSON.parse(skeletonRaw));
  if (!skeletonResult.success) {
    throw new Error(
      `Invalid skeleton.json in "${id}": ${skeletonResult.error.message}`,
    );
  }

  // Read and validate manifest.json
  const manifestPath = join(skeletonDir, "manifest.json");
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, "utf-8");
  } catch {
    throw new Error(`Missing manifest.json in skeleton "${id}"`);
  }

  const manifestResult = ManifestSchema.safeParse(JSON.parse(manifestRaw));
  if (!manifestResult.success) {
    throw new Error(
      `Invalid manifest.json in "${id}": ${manifestResult.error.message}`,
    );
  }

  // Read all files listed in the manifest
  const filesDir = join(skeletonDir, "files");
  const files: Record<string, string> = {};

  for (const entry of manifestResult.data.files) {
    const filePath = join(filesDir, entry.path);
    try {
      files[entry.path] = await readFile(filePath, "utf-8");
    } catch {
      throw new Error(
        `Missing file "${entry.path}" declared in manifest of skeleton "${id}"`,
      );
    }
  }

  return {
    skeleton: skeletonResult.data,
    manifest: manifestResult.data,
    files,
  };
}

export type SkeletonSummary = { id: string } & Skeleton;

let cachedSummaries: SkeletonSummary[] | null = null;

/**
 * List all available skeletons with parsed metadata (excluding file contents).
 * Cached in-process; skeletons don't change at runtime.
 */
export async function listSkeletons(): Promise<SkeletonSummary[]> {
  if (cachedSummaries) return cachedSummaries;

  const entries = await readdir(__dirname, { withFileTypes: true });
  const summaries: SkeletonSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("__")) continue;

    const skeletonPath = join(__dirname, entry.name, "skeleton.json");
    try {
      const raw = await readFile(skeletonPath, "utf-8");
      const parsed = SkeletonSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        summaries.push({ id: entry.name, ...parsed.data });
      } else {
        console.warn(
          `[skeletons] skipping "${entry.name}": invalid skeleton.json — ${parsed.error.message}`,
        );
      }
    } catch (err) {
      // Directories without skeleton.json are expected; only warn on other failures.
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
        console.warn(
          `[skeletons] skipping "${entry.name}": ${(err as Error).message}`,
        );
      }
    }
  }

  summaries.sort((a, b) => a.name.localeCompare(b.name));
  cachedSummaries = summaries;
  return summaries;
}
