import type { LoadedSkeleton } from "../../types.js";
import type { DimScore } from "../types.js";
import { countExecutableLoc, isConfigOrEntry, isTypeScriptSource } from "./util.js";

export function d3DomainDepth(loaded: LoadedSkeleton): DimScore {
  let totalLoc = 0;
  const breakdown: Record<string, number> = {};

  for (const [path, content] of Object.entries(loaded.files)) {
    if (!isTypeScriptSource(path)) continue;
    if (/__tests__\//.test(path) || /\.test\.tsx?$/.test(path)) continue;
    if (isConfigOrEntry(path)) continue;
    const loc = countExecutableLoc(content);
    breakdown[path] = loc;
    totalLoc += loc;
  }

  let score: 1 | 2 | 3 | 4 | 5;
  if (totalLoc < 100) score = 1;
  else if (totalLoc < 200) score = 2;
  else if (totalLoc < 300) score = 3;
  else if (totalLoc < 400) score = 4;
  else score = 5;

  return {
    dim: "D3_domainDepth",
    score,
    evidence: {
      totalLoc,
      breakdown: Object.entries(breakdown)
        .sort((a, b) => b[1] - a[1])
        .map(([p, n]) => `${p}:${n}`),
    },
  };
}
