/**
 * Deep-dive runner for the remix generation pipeline.
 *
 * Usage:
 *   npx tsx src/remix/perf-deep-dive.ts
 *   npx tsx src/remix/perf-deep-dive.ts fullstack-platform-risk
 */
import "dotenv/config";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { remix } from "./remix.js";
import type { RemixResult } from "./types.js";

type DeepDiveCase = {
  id: string;
  skeletonId: string;
  prompt: string;
  examSpecifics: string;
};

const CASES: DeepDiveCase[] = [
  {
    id: "fullstack-platform-risk",
    skeletonId: "fullstack-support-hub",
    prompt: `
      RelayForge is a 180-person Series C company building AI-assisted customer operations software for
      enterprise SaaS support teams. We are hiring a Senior Full-Stack Product Engineer for the Workflow
      Reliability pod. The engineer will own React + TypeScript workflows, Node/Express APIs, shared domain
      models, and risk-scoring logic that decides when high-value accounts need escalation before renewal risk
      becomes visible.

      We want an assessment that feels like a real slice of our product. Candidates should work across client,
      server, and shared logic. The task should force them to make tradeoffs around state consistency, optimistic
      updates, validation, backward-compatible API shape, and explainable risk scoring. It should not be a generic
      CRUD ticket app. We care about engineering judgment, test strategy, product empathy, and the ability to keep
      a small but realistic system coherent under changing business rules.
    `,
    examSpecifics:
      "Target 75-90 minutes. Include existing tests plus one or two gaps the candidate should identify. The assessment should reward candidates who preserve API contracts while improving cross-layer behavior.",
  },
  {
    id: "data-reliability-incidents",
    skeletonId: "data-pipeline-insights",
    prompt: `
      Arclight Health is a fast-growing healthtech company processing real-time patient access events for
      hospital scheduling teams. We are hiring a Senior Data Platform Engineer to improve TypeScript services
      that reconcile batch exports with streaming events, detect late or duplicate signals, and produce concise
      operational reports for on-call coordinators.

      The assessment should simulate a realistic reliability problem: metrics from batch and stream paths disagree
      around incident windows, and the candidate must decide how to normalize timestamps, handle out-of-order
      events, preserve deterministic output, and expose useful report summaries without overfitting to sample data.
      We want a task that separates engineers who understand data pipeline correctness from engineers who only
      add a map/filter pass.
    `,
    examSpecifics:
      "Target 60-75 minutes. The tests should cover edge cases around lateness, duplicate events, and deterministic report ordering. The prompt should make tradeoffs explicit.",
  },
  {
    id: "ops-cli-release-readiness",
    skeletonId: "ops-cli-audit",
    prompt: `
      VectorLedger is a high-growth fintech infra company whose platform team ships regulated ledger services
      weekly. We are hiring a Senior Infrastructure Engineer to improve an internal release-readiness CLI used by
      service owners before deploys. The tool audits service health snapshots, suppresses approved noisy findings,
      and emits text/JSON reports consumed by CI.

      The assessment should ask candidates to evolve a CLI that has to balance operator ergonomics with strict
      machine-readable output. Candidates should reason about suppression matching, severity ordering, JSON
      stability, malformed input, and how much policy belongs in parsing versus reporting. This should feel like
      production tooling at a company moving quickly under compliance constraints, not a toy command parser.
    `,
    examSpecifics:
      "Target 60-75 minutes. The assessment should require meaningful CLI/API boundary decisions and test coverage for both text and JSON output.",
  },
];

function qualitySignals(result: RemixResult) {
  const readme = result.workspace.files["README.md"] ?? "";
  const allText = [
    result.instructionsMd,
    readme,
    result.workspace.scenario.narrative,
    ...result.workspace.tasks.map((task) => `${task.title}\n${task.description}`),
    ...result.workspace.rubric.map((entry) => `${entry.criterion} ${entry.weight}`),
  ].join("\n");

  const testFiles = Object.entries(result.workspace.files).filter(([path]) =>
    /\.(test|spec)\.[tj]sx?$/.test(path),
  );
  const testAssertions = testFiles.reduce((count, [, content]) => {
    return count + (content.match(/\b(expect|it|test)\s*\(/g)?.length ?? 0);
  }, 0);
  const candidateFiles = Object.entries(result.workspace.files).filter(([, content]) =>
    /\bTODO\b|throw new Error\(["']Not implemented|stub/i.test(content),
  );
  const decisionLanguageHits = [
    "tradeoff",
    "backward-compatible",
    "deterministic",
    "edge case",
    "policy",
    "consistency",
    "validation",
    "risk",
    "late",
    "duplicate",
    "severity",
    "contract",
    "optimistic",
  ].filter((term) => allText.toLowerCase().includes(term)).length;

  return {
    instructionsLength: result.instructionsMd.length,
    readmeLength: readme.length,
    taskCount: result.workspace.tasks.length,
    rubricWeightTotal: Number(
      result.workspace.rubric.reduce((sum, entry) => sum + entry.weight, 0).toFixed(3),
    ),
    testFileCount: testFiles.length,
    testAssertions,
    placeholderOrStubFileCount: candidateFiles.length,
    decisionLanguageHits,
    hasCandidateInstructions: /candidate|your task|implement|deliver/i.test(allText),
    mentionsTesting: /test|vitest|coverage/i.test(allText),
  };
}

async function writeWorkspace(outDir: string, result: RemixResult) {
  for (const [path, content] of Object.entries(result.workspace.files)) {
    const fullPath = join(outDir, "workspace", path);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content);
  }
  await writeFile(join(outDir, "instructions.md"), result.instructionsMd);
  await writeFile(
    join(outDir, "metadata.json"),
    JSON.stringify(
      {
        brief: result.brief,
        scenario: result.workspace.scenario,
        tasks: result.workspace.tasks,
        rubric: result.workspace.rubric,
        validation: result.validation,
        usage: result.usage,
        qualitySignals: qualitySignals(result),
      },
      null,
      2,
    ),
  );
}

async function runCase(testCase: DeepDiveCase, outputRoot: string) {
  const started = performance.now();
  const result = await remix({
    skeletonId: testCase.skeletonId,
    jobBrief: testCase.prompt,
    examSpecifics: testCase.examSpecifics,
  });
  const totalDurationMs = Math.round(performance.now() - started);
  const outDir = join(outputRoot, testCase.id);
  await writeWorkspace(outDir, result);

  return {
    id: testCase.id,
    skeletonId: testCase.skeletonId,
    totalDurationMs,
    totalDurationSec: Math.round(totalDurationMs / 1000),
    validation: result.validation,
    usage: result.usage,
    qualitySignals: qualitySignals(result),
    outputDir: outDir,
  };
}

async function main() {
  const requestedIds = new Set(process.argv.slice(2));
  const selected = requestedIds.size
    ? CASES.filter((testCase) => requestedIds.has(testCase.id))
    : CASES;

  if (selected.length === 0) {
    console.error(`No matching cases. Available: ${CASES.map((testCase) => testCase.id).join(", ")}`);
    process.exit(1);
  }

  const outputRoot = join(process.cwd(), "output", `perf-deep-dive-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const summaries = [];
  for (const testCase of selected) {
    console.error(`\n=== Deep Dive Case: ${testCase.id} (${testCase.skeletonId}) ===\n`);
    summaries.push(await runCase(testCase, outputRoot));
  }

  const summaryPath = join(outputRoot, "summary.json");
  await writeFile(summaryPath, JSON.stringify({ generatedAt: new Date().toISOString(), summaries }, null, 2));

  console.log(JSON.stringify({ outputRoot, summaryPath, summaries }, null, 2));
}

main().catch((err) => {
  console.error("Deep-dive run failed:", err);
  process.exit(1);
});
