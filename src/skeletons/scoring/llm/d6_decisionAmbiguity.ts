import type { LoadedSkeleton } from "../../types.js";
import type { DimScore } from "../types.js";
import { llmDimScore } from "./llmDim.js";

export async function d6DecisionAmbiguity(
  loaded: LoadedSkeleton,
  options: { samples: number; model?: string },
): Promise<DimScore> {
  return llmDimScore(loaded, "d6_decisionAmbiguity.md", "D6_decisionAmbiguity", options);
}
