import type { LoadedSkeleton } from "../../types.js";
import type { DimScore } from "../types.js";
import {
  extractImportSpecifiers,
  getCandidatePartialPaths,
  isTypeScriptSource,
  resolveRelativeImport,
} from "./util.js";

const MAX_DEPTH = 2;

export function d1ModuleSpan(loaded: LoadedSkeleton): DimScore {
  const roots = getCandidatePartialPaths(loaded).filter(isTypeScriptSource);
  const allTsPaths = Object.keys(loaded.files).filter(isTypeScriptSource);

  const visited = new Set<string>();
  const queue: { path: string; depth: number }[] = roots.map((p) => ({ path: p, depth: 0 }));
  for (const r of roots) visited.add(r);

  while (queue.length) {
    const { path, depth } = queue.shift()!;
    if (depth >= MAX_DEPTH) continue;
    const content = loaded.files[path];
    if (!content) continue;
    const specs = extractImportSpecifiers(content, path);
    for (const spec of specs) {
      const resolved = resolveRelativeImport(path, spec, allTsPaths);
      if (!resolved) continue;
      if (/__tests__\//.test(resolved)) continue;
      if (!visited.has(resolved)) {
        visited.add(resolved);
        queue.push({ path: resolved, depth: depth + 1 });
      }
    }
  }

  const reachable = [...visited].filter((p) => !roots.includes(p));
  const subtrees = new Set(
    reachable.map((p) => {
      const dir = p.split("/").slice(0, -1).join("/");
      return dir.split("/")[1] ?? dir;
    }),
  );

  let score: 1 | 2 | 3 | 4 | 5;
  if (reachable.length === 0) score = 1;
  else if (reachable.length <= 2) score = 2;
  else if (reachable.length <= 4) score = 3;
  else if (reachable.length >= 6 && subtrees.size >= 2) score = 5;
  else score = 4;

  return {
    dim: "D1_moduleSpan",
    score,
    evidence: {
      roots,
      reachableCount: reachable.length,
      reachable,
      subtrees: [...subtrees],
    },
  };
}
