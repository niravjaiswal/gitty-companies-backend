import type { LoadedSkeleton } from "../../types.js";
import type { DimScore } from "../types.js";
import {
  countExpectCalls,
  extractImportSpecifiers,
  getCandidatePartialPaths,
  getTestPaths,
  resolveRelativeImport,
} from "./util.js";

const EDGE_KEYWORDS = [
  "empty",
  "boundary",
  "edge",
  "conflict",
  "concurrent",
  "race",
  "duplicate",
  "missing",
  "invalid",
  "malformed",
  "overflow",
  "negative",
  "zero",
  "null",
  "undefined",
  "out of range",
  "boundary",
  "stale",
];

const MAX_TRANSITIVE_DEPTH = 3;

function reachesPartial(
  startPath: string,
  candidatePartial: Set<string>,
  files: Record<string, string>,
  allPaths: string[],
): boolean {
  const visited = new Set<string>([startPath]);
  const queue: { path: string; depth: number }[] = [{ path: startPath, depth: 0 }];
  while (queue.length) {
    const { path, depth } = queue.shift()!;
    if (depth >= MAX_TRANSITIVE_DEPTH) continue;
    const content = files[path];
    if (!content) continue;
    for (const spec of extractImportSpecifiers(content, path)) {
      const resolved = resolveRelativeImport(path, spec, allPaths);
      if (!resolved || visited.has(resolved)) continue;
      visited.add(resolved);
      if (candidatePartial.has(resolved)) return true;
      queue.push({ path: resolved, depth: depth + 1 });
    }
  }
  return false;
}

export function d4TestCoverage(loaded: LoadedSkeleton): DimScore {
  const candidatePartial = new Set(getCandidatePartialPaths(loaded));
  const testPaths = getTestPaths(loaded);
  const allPaths = Object.keys(loaded.files);

  let testsTargetingHardPath = 0;
  let totalExpectCalls = 0;
  const edgeKeywordHits = new Set<string>();
  const targetingTests: string[] = [];

  for (const tp of testPaths) {
    const content = loaded.files[tp];
    if (!content) continue;
    const targetsHard = reachesPartial(tp, candidatePartial, loaded.files, allPaths);
    if (targetsHard) {
      testsTargetingHardPath++;
      targetingTests.push(tp);
      totalExpectCalls += countExpectCalls(content);
      const lower = content.toLowerCase();
      for (const kw of EDGE_KEYWORDS) {
        if (lower.includes(kw)) edgeKeywordHits.add(kw);
      }
    }
  }

  let score: 1 | 2 | 3 | 4 | 5;
  if (testsTargetingHardPath === 0) score = 1;
  else if (testsTargetingHardPath === 1 && totalExpectCalls < 5) score = 2;
  else if (totalExpectCalls < 10) score = 3;
  else if (totalExpectCalls < 15 || edgeKeywordHits.size < 3) score = 4;
  else score = 5;

  return {
    dim: "D4_testCoverageHardPath",
    score,
    evidence: {
      testsTargetingHardPath,
      totalExpectCalls,
      edgeKeywordCount: edgeKeywordHits.size,
      edgeKeywords: [...edgeKeywordHits],
      targetingTests,
    },
  };
}
