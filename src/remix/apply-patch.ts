import type { LoadedSkeleton, RemixPatch } from "../skeletons/types.js";
import type { RemixedWorkspace } from "./types.js";

/**
 * Pure deterministic merge of a RemixPatch onto a LoadedSkeleton.
 *
 * Rules:
 *  - Only files marked `adapt: true` in the manifest may be patched.
 *  - Patching a known but non-adapt file is a hard error (LLM violated contract).
 *  - Patching an unknown file emits a warning and is skipped.
 *  - Any adapt-true file that receives no patch emits a warning.
 */
export function applyPatch(
  loaded: LoadedSkeleton,
  patch: RemixPatch,
): { workspace: RemixedWorkspace; warnings: string[] } {
  const adaptPaths = new Set(
    loaded.manifest.files.filter((f) => f.adapt).map((f) => f.path),
  );
  const knownPaths = new Set(loaded.manifest.files.map((f) => f.path));

  const files = { ...loaded.files };
  const warnings: string[] = [];
  const patchedPaths = new Set<string>();

  for (const entry of patch.file_patches) {
    if (knownPaths.has(entry.path) && !adaptPaths.has(entry.path)) {
      throw new Error(
        `RemixPatch violates skeleton contract: attempted to patch static file '${entry.path}' (adapt: false)`,
      );
    }

    if (!knownPaths.has(entry.path)) {
      warnings.push(`Patch targets unknown file: ${entry.path}`);
      continue;
    }

    // Valid adapt-true path
    files[entry.path] = entry.content;
    patchedPaths.add(entry.path);
  }

  for (const path of adaptPaths) {
    if (!patchedPaths.has(path)) {
      warnings.push(`No patch provided for adapt-true file: ${path}`);
    }
  }

  return {
    workspace: {
      files,
      scenario: patch.scenario,
      tasks: patch.tasks,
      rubric: patch.rubric,
    },
    warnings,
  };
}
