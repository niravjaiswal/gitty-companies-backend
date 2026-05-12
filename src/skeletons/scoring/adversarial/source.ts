import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkeleton } from "../../loader.js";
import type { Manifest } from "../../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKELETONS_DIR = join(__dirname, "..", "..");

/**
 * Generic source the adversarial gate can run against.
 *
 * `filesDir` is the on-disk directory the sandbox copies from (preserves
 * pre-installed node_modules for speed). `files` is the in-memory baseline
 * the diff compares the agent's edits against.
 */
export type AdversarialSource = {
  name: string;
  manifest: Manifest;
  files: Record<string, string>;
  filesDir: string;
  readme: string;
};

export async function adversarialSourceFromSkeleton(
  id: string,
): Promise<AdversarialSource> {
  const loaded = await loadSkeleton(id);
  return {
    name: loaded.skeleton.name,
    manifest: loaded.manifest,
    files: loaded.files,
    filesDir: join(SKELETONS_DIR, id, "files"),
    readme: loaded.files["README.md"] ?? "",
  };
}

export function adversarialSourceFromWorkspace(args: {
  name: string;
  manifest: Manifest;
  files: Record<string, string>;
  filesDir: string;
  readme?: string;
}): AdversarialSource {
  return {
    name: args.name,
    manifest: args.manifest,
    files: args.files,
    filesDir: args.filesDir,
    readme: args.readme ?? args.files["README.md"] ?? "",
  };
}
