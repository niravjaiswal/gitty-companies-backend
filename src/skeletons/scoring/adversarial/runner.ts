import { runSolverAgent } from "./agent.js";
import { judgeRun } from "./judge.js";
import {
  cleanupSandbox,
  computeDiff,
  createSandbox,
  runTests,
} from "./sandbox.js";
import {
  adversarialSourceFromSkeleton,
  type AdversarialSource,
} from "./source.js";
import type {
  AdversarialAggregate,
  AdversarialOptions,
  AdversarialReport,
  AdversarialRun,
  QualityVerdict,
} from "./types.js";

const DEFAULT_MAX_TURNS = 25;
const DEFAULT_RUNS = 1;
const DEFAULT_MODEL = "claude-sonnet-4-6";

export async function runAdversarial(
  source: AdversarialSource,
  options: AdversarialOptions = {},
): Promise<AdversarialReport> {
  const numRuns = options.runs ?? DEFAULT_RUNS;
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const model = options.model ?? DEFAULT_MODEL;

  const runs: AdversarialRun[] = [];

  for (let i = 0; i < numRuns; i++) {
    process.stderr.write(`  [adversarial:${source.name}] run ${i + 1}/${numRuns}\n`);
    const handle = await createSandbox(source, options.workDir);
    try {
      const agentResult = await runSolverAgent(handle, maxTurns, model);
      const testResult = await runTests(handle);
      const diff = await computeDiff(handle);

      let decisions = [] as AdversarialRun["decisions"];
      let hardcoding = { detected: false, evidence: "" };
      let judgeError: string | undefined;
      try {
        const judge = await judgeRun({
          source,
          diff,
          finalText: agentResult.finalText,
          testsPassed: testResult.passed,
          model,
        });
        decisions = judge.decisions;
        hardcoding = judge.hardcoding;
      } catch (err) {
        judgeError = err instanceof Error ? err.message : String(err);
      }

      const errorParts = [agentResult.rawError, judgeError].filter(Boolean);

      runs.push({
        runId: handle.runId,
        solved: testResult.passed,
        turnsUsed: agentResult.turnsUsed,
        numEdits: agentResult.numEdits,
        filesTouched: diff.filesTouched,
        testFilesTouched: diff.testFilesTouched,
        locDelta: diff.locDelta,
        costUsd: agentResult.costUsd,
        testOutput: testResult.output.slice(-4000),
        transcriptPath: agentResult.transcriptPath,
        decisions,
        hardcoding,
        error: errorParts.length ? errorParts.join("; ") : undefined,
      });
    } finally {
      await cleanupSandbox(handle);
    }
  }

  const aggregate = aggregateRuns(runs);
  const { verdict, rationale } = computeQualityVerdict(aggregate);

  return {
    skeleton: source.name,
    scoredAt: new Date().toISOString(),
    model,
    maxTurns,
    numRuns,
    runs,
    aggregate,
    qualityVerdict: verdict,
    verdictRationale: rationale,
  };
}

/**
 * Convenience wrapper: load a skeleton by id and run the gate.
 * Keeps the skeleton-id ergonomics for the CLI without coupling runner.ts.
 */
export async function runAdversarialForSkeleton(
  skeletonId: string,
  options: AdversarialOptions = {},
): Promise<AdversarialReport> {
  const source = await adversarialSourceFromSkeleton(skeletonId);
  return runAdversarial(source, options);
}

function aggregateRuns(runs: AdversarialRun[]): AdversarialAggregate {
  if (runs.length === 0) {
    return {
      solvedRate: 0,
      medianTurns: 0,
      medianEdits: 0,
      avgCostUsd: 0,
      hardcodingObserved: false,
      testFilesModified: false,
      judgmentCallsObserved: false,
      architecturalDecisionsObserved: false,
    };
  }
  const solved = runs.filter((r) => r.solved).length;
  return {
    solvedRate: solved / runs.length,
    medianTurns: median(runs.map((r) => r.turnsUsed)),
    medianEdits: median(runs.map((r) => r.numEdits)),
    avgCostUsd:
      Number(
        (runs.reduce((s, r) => s + r.costUsd, 0) / runs.length).toFixed(4),
      ),
    hardcodingObserved: runs.some((r) => r.hardcoding.detected),
    testFilesModified: runs.some((r) => r.testFilesTouched.length > 0),
    judgmentCallsObserved: runs.some((r) =>
      r.decisions.some((d) => d.category === "judgment_call"),
    ),
    architecturalDecisionsObserved: runs.some((r) =>
      r.decisions.some((d) => d.category === "architectural"),
    ),
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeQualityVerdict(
  agg: AdversarialAggregate,
): { verdict: QualityVerdict; rationale: string } {
  if (agg.solvedRate === 0) {
    return {
      verdict: "too-hard",
      rationale: "Agent failed all runs — skeleton may be unsolvable in turn budget or specs are unclear.",
    };
  }
  if (agg.testFilesModified) {
    return {
      verdict: "tests-cheated",
      rationale:
        "Agent modified test files to pass. Either tests had bugs, conflicted with the README spec, or the agent abandoned the contract. Inspect transcripts before trusting the result.",
    };
  }
  if (agg.hardcodingObserved) {
    return {
      verdict: "broken-tests",
      rationale:
        "Agent hardcoded fixture values and tests still passed. Tests do not bind real behavior — strengthen test assertions.",
    };
  }
  if (
    agg.solvedRate >= 0.8 &&
    agg.medianEdits < 3 &&
    !agg.judgmentCallsObserved &&
    !agg.architecturalDecisionsObserved
  ) {
    return {
      verdict: "too-easy",
      rationale:
        "Agent solved with <3 edits and made no judgment calls. Task has one obvious answer — surface a fork.",
    };
  }
  return {
    verdict: "calibrated",
    rationale:
      "Agent made real decisions and tests constrained behavior. Skeleton signals real engineering work.",
  };
}
