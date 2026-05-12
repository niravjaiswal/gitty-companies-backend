import type { LoadedSkeleton } from "../types.js";

export type DimId =
  | "D1_moduleSpan"
  | "D2_contractSurface"
  | "D3_domainDepth"
  | "D4_testCoverageHardPath"
  | "D5_crossLayerWiring"
  | "D6_decisionAmbiguity"
  | "D7_edgeCaseDensity";

export type DimScore = {
  dim: DimId;
  score: 1 | 2 | 3 | 4 | 5;
  evidence: Record<string, number | string | number[] | string[]>;
};

export type StaticDimFn = (loaded: LoadedSkeleton) => DimScore;

export type LlmDimFn = (
  loaded: LoadedSkeleton,
  options: { samples: number; model: string },
) => Promise<DimScore>;

export type Tier = "top" | "middle" | "bottom";
export type Verdict = "keep" | "strengthen" | "drop";

export type SkeletonScoreReport = {
  skeleton: string;
  scoredAt: string;
  scores: Record<DimId, DimScore>;
  weakest: DimId[];
  median: number;
  tier: Tier;
  verdict: Verdict;
  verdictRationale: string;
};
