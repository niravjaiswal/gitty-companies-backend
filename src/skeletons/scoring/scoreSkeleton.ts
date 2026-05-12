import { loadSkeleton } from "../loader.js";
import { d1ModuleSpan } from "./static/d1_moduleSpan.js";
import { d2ContractSurface } from "./static/d2_contractSurface.js";
import { d3DomainDepth } from "./static/d3_domainDepth.js";
import { d4TestCoverage } from "./static/d4_testCoverage.js";
import { d5CrossLayerWiring } from "./static/d5_crossLayerWiring.js";
import { d6DecisionAmbiguity } from "./llm/d6_decisionAmbiguity.js";
import { d7EdgeCaseDensity } from "./llm/d7_edgeCaseDensity.js";
import type { DimId, DimScore, SkeletonScoreReport, Tier, Verdict } from "./types.js";
import type { LoadedSkeleton } from "../types.js";

export type ScoreOptions = {
  llmSamples?: number;
  skipLlm?: boolean;
  model?: string;
};

export async function scoreSkeleton(
  skeletonId: string,
  options: ScoreOptions = {},
): Promise<SkeletonScoreReport> {
  const loaded = await loadSkeleton(skeletonId);
  return scoreLoadedSkeleton(loaded, options);
}

export async function scoreLoadedSkeleton(
  loaded: LoadedSkeleton,
  options: ScoreOptions = {},
): Promise<SkeletonScoreReport> {
  const samples = options.llmSamples ?? 3;

  const staticScores: DimScore[] = [
    d1ModuleSpan(loaded),
    d2ContractSurface(loaded),
    d3DomainDepth(loaded),
    d4TestCoverage(loaded),
    d5CrossLayerWiring(loaded),
  ];

  const llmScores: DimScore[] = options.skipLlm
    ? []
    : await Promise.all([
        d6DecisionAmbiguity(loaded, { samples, model: options.model }),
        d7EdgeCaseDensity(loaded, { samples, model: options.model }),
      ]);

  const all = [...staticScores, ...llmScores];

  const scoresMap = Object.fromEntries(all.map((s) => [s.dim, s])) as Record<DimId, DimScore>;

  const numeric = all.map((s) => s.score);
  const sorted = [...numeric].sort((a, b) => a - b);
  const median =
    sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

  const minScore = Math.min(...numeric);
  const tier: Tier = computeTier(median, minScore, scoresMap, !options.skipLlm);

  const weakest = all
    .filter((s) => s.score <= 2)
    .sort((a, b) => a.score - b.score)
    .map((s) => s.dim);

  const { verdict, rationale } = computeVerdict(tier, scoresMap);

  return {
    skeleton: loaded.skeleton.name,
    scoredAt: new Date().toISOString(),
    scores: scoresMap,
    weakest,
    median,
    tier,
    verdict,
    verdictRationale: rationale,
  };
}

function computeTier(
  median: number,
  minScore: number,
  scores: Record<DimId, DimScore>,
  hasLlm: boolean,
): Tier {
  const d1 = scores.D1_moduleSpan?.score ?? 5;
  const d2 = scores.D2_contractSurface?.score ?? 5;
  const d3 = scores.D3_domainDepth?.score ?? 5;
  const coreFloor = Math.min(d1, d2, d3);

  if (median < 3 || coreFloor === 1) return "bottom";
  if (median >= 4 && minScore >= 3 && hasLlm) return "top";
  return "middle";
}

function computeVerdict(
  tier: Tier,
  scores: Record<DimId, DimScore>,
): { verdict: Verdict; rationale: string } {
  if (tier === "top") {
    return { verdict: "keep", rationale: "Top tier; no action needed." };
  }
  if (tier === "middle") {
    return {
      verdict: "strengthen",
      rationale: "Middle tier; targeted uplift on weak dims.",
    };
  }
  // bottom: decide drop vs strengthen by whether bones exist
  const d3 = scores.D3_domainDepth?.score ?? 0;
  if (d3 >= 3) {
    return {
      verdict: "strengthen",
      rationale: "Bottom tier but D3 domain depth ≥ 3 indicates bones exist; surface them.",
    };
  }
  return {
    verdict: "drop",
    rationale:
      "Bottom tier with D3 domain depth < 3; source genuinely thin, strengthening would fabricate complexity.",
  };
}
