export type DecisionCategory = "mechanical" | "judgment_call" | "architectural";

export type DecisionObservation = {
  description: string;
  category: DecisionCategory;
  alternativeConsidered?: string;
};

export type HardcodingObservation = {
  detected: boolean;
  evidence: string;
};

export type TestModificationKind = "none" | "additions_only" | "modified_existing";

export type AdversarialRun = {
  runId: string;
  solved: boolean;
  turnsUsed: number;
  numEdits: number;
  filesTouched: string[];
  testFilesTouched: string[];
  testModificationKind: TestModificationKind;
  locDelta: number;
  costUsd: number;
  testOutput: string;
  transcriptPath: string;
  decisions: DecisionObservation[];
  hardcoding: HardcodingObservation;
  error?: string;
};

export type QualityVerdict =
  | "too-easy"
  | "calibrated"
  | "too-hard"
  | "broken-tests"
  | "tests-cheated";

export type AdversarialAggregate = {
  solvedRate: number;
  medianTurns: number;
  medianEdits: number;
  avgCostUsd: number;
  hardcodingObserved: boolean;
  testFilesModified: boolean;
  testModificationKind: TestModificationKind;
  judgmentCallsObserved: boolean;
  architecturalDecisionsObserved: boolean;
};

export type AdversarialReport = {
  skeleton: string;
  scoredAt: string;
  model: string;
  maxTurns: number;
  numRuns: number;
  runs: AdversarialRun[];
  aggregate: AdversarialAggregate;
  qualityVerdict: QualityVerdict;
  verdictRationale: string;
};

export type AdversarialOptions = {
  runs?: number;
  maxTurns?: number;
  model?: string;
  outDir?: string;
  workDir?: string;
};
