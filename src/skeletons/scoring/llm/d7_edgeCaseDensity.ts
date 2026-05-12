import type { LoadedSkeleton } from "../../types.js";
import type { DimScore } from "../types.js";
import { llmDimScore } from "./llmDim.js";

export async function d7EdgeCaseDensity(
  loaded: LoadedSkeleton,
  options: { samples: number; model?: string },
): Promise<DimScore> {
  return llmDimScore(loaded, "d7_edgeCaseDensity.md", "D7_edgeCaseDensity", options);
}
