import type { LoadedSkeleton } from "../../types.js";
import type { DimScore } from "../types.js";
import {
  countExports,
  getProvidedAdaptablePaths,
  getProvidedStaticPaths,
  getTestPaths,
  isTypeScriptSource,
} from "./util.js";

export function d2ContractSurface(loaded: LoadedSkeleton): DimScore {
  // Protected exports = exports in adapt:false files (those CANNOT change during remix).
  // Also include exports in provided+adapt:true files at half weight, since the remix
  // agent is supposed to preserve their public shape even though it may re-theme.
  const staticPaths = getProvidedStaticPaths(loaded).filter(isTypeScriptSource);
  const adaptablePaths = getProvidedAdaptablePaths(loaded).filter(isTypeScriptSource);

  const protectedNames: string[] = [];
  for (const path of staticPaths) {
    const content = loaded.files[path];
    if (!content) continue;
    const { names } = countExports(content, path);
    protectedNames.push(...names);
  }

  const adaptableNames: string[] = [];
  for (const path of adaptablePaths) {
    const content = loaded.files[path];
    if (!content) continue;
    const { names } = countExports(content, path);
    adaptableNames.push(...names);
  }

  const protectedCount = protectedNames.length;
  const adaptableCount = adaptableNames.length;
  const effectiveExports = protectedCount + Math.floor(adaptableCount / 2);

  const allNames = new Set([...protectedNames, ...adaptableNames]);
  let assertionsReferencingExports = 0;
  for (const tp of getTestPaths(loaded)) {
    const content = loaded.files[tp];
    if (!content) continue;
    for (const name of allNames) {
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      const m = content.match(re);
      if (m) assertionsReferencingExports += m.length;
    }
  }

  let score: 1 | 2 | 3 | 4 | 5;
  if (effectiveExports <= 2) score = 1;
  else if (effectiveExports <= 4) score = 2;
  else if (effectiveExports <= 7) score = 3;
  else if (effectiveExports <= 10 || assertionsReferencingExports < 5) score = 4;
  else score = 5;

  return {
    dim: "D2_contractSurface",
    score,
    evidence: {
      protectedCount,
      adaptableCount,
      effectiveExports,
      assertionsReferencingExports,
      protectedNames,
    },
  };
}
