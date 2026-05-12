import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { RepoExecutor } from "../validation/index.js";
import type { Manifest, VariationAxis } from "../skeletons/types.js";
import type { Brief } from "./types.js";
import { combineOutput } from "./agent-adapt.js";
import {
  buildVarySystemPrompt,
  buildVaryUserPrompt,
} from "./agent-vary-prompts.js";
import type { VariationPlan, VariationSelection } from "./variation-planner.js";

const AGENT_MODEL = "claude-sonnet-4-6";
const MAX_TURNS = 60;
const MAX_BUDGET_USD = 1.5;

const VaryMetadataSchema = z.object({
  applied: z
    .array(
      z.object({
        axis_id: z.string().min(1),
        value: z.union([z.string(), z.number(), z.boolean()]),
        summary: z.string().min(1),
      }),
    )
    .default([]),
  test_coverage_notes: z.string().default(""),
});

export type VaryMetadata = z.infer<typeof VaryMetadataSchema>;

export interface AgentVaryResult {
  applied: VariationSelection[];
  metadata: VaryMetadata;
  usage: {
    totalCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    turns: number;
    durationMs: number;
  };
  verified: boolean;
  tscOutput: string;
  vitestOutput: string;
  sacredViolations: string[];
}

export async function agentVary(args: {
  executor: RepoExecutor;
  brief: Brief;
  manifest: Manifest;
  plan: VariationPlan;
  axes: VariationAxis[];
}): Promise<AgentVaryResult> {
  const { executor, brief, manifest, plan, axes } = args;

  const nonDefault = plan.selections.filter((s) => !s.isDefault);

  if (nonDefault.length === 0) {
    console.error(`[agent-vary] No non-default variations — skipping executor agent.`);
    const tscResult = await executor.tscCheck();
    const vitestResult = await executor.vitestRun();
    const verified = tscResult.exitCode === 0 && vitestResult.exitCode === 0;
    return {
      applied: [],
      metadata: { applied: [], test_coverage_notes: "no variations applied" },
      usage: { totalCostUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, durationMs: 0 },
      verified,
      tscOutput: verified ? "" : combineOutput(tscResult.stdout, tscResult.stderr),
      vitestOutput: verified ? "" : combineOutput(vitestResult.stdout, vitestResult.stderr),
      sacredViolations: [],
    };
  }

  // Snapshot sacred anchors before the agent runs.
  const sacredBefore = await captureSacredAnchors(executor, manifest);

  const adaptPaths = manifest.files.filter((f) => f.adapt).map((f) => f.path);
  const adaptFilesMap = await executor.readAllFiles(adaptPaths);
  const fileContents: Record<string, string> = {};
  for (const [path, content] of adaptFilesMap) {
    fileContents[path] = content;
  }

  const systemPrompt = buildVarySystemPrompt();
  const userPrompt = buildVaryUserPrompt({
    brief,
    manifest,
    plan,
    axes,
    fileContents,
  });

  console.error(`[agent-vary] Starting executor in ${executor.dir} (${nonDefault.length} axes to flex)`);

  let resultMessage: {
    totalCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    turns: number;
    durationMs: number;
    isError: boolean;
    subtype: string;
  } | null = null;

  try {
    for await (const message of query({
      prompt: userPrompt,
      options: {
        model: AGENT_MODEL,
        systemPrompt,
        cwd: executor.dir,
        maxTurns: MAX_TURNS,
        maxBudgetUsd: MAX_BUDGET_USD,
        allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        settingSources: [],
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("name" in block) {
            console.error(`[agent-vary]   tool: ${block.name}`);
          }
        }
      } else if (message.type === "result") {
        resultMessage = {
          totalCostUsd: message.total_cost_usd,
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          turns: message.num_turns,
          durationMs: message.duration_ms,
          isError: message.is_error,
          subtype: message.subtype,
        };
        console.error(
          `[agent-vary] Agent done: ${message.subtype} | ${message.num_turns} turns | $${message.total_cost_usd.toFixed(3)}`,
        );
      }
    }
  } catch (err) {
    if (resultMessage) {
      console.error(`[agent-vary] Stream error after completion (ignored): ${err}`);
    } else {
      throw err;
    }
  }

  if (!resultMessage) {
    throw new Error("Vary agent returned no result message");
  }

  // Verification gate
  const tscResult = await executor.tscCheck();
  const vitestResult = await executor.vitestRun();
  const verified = tscResult.exitCode === 0 && vitestResult.exitCode === 0;
  const tscOutput = tscResult.exitCode === 0 ? "" : combineOutput(tscResult.stdout, tscResult.stderr);
  const vitestOutput = vitestResult.exitCode === 0 ? "" : combineOutput(vitestResult.stdout, vitestResult.stderr);

  // Sacred-anchor check
  const sacredAfter = await captureSacredAnchors(executor, manifest);
  const sacredViolations = diffSacredAnchors(sacredBefore, sacredAfter);

  // Read metadata
  let metadata: VaryMetadata = { applied: [], test_coverage_notes: "" };
  try {
    const raw = await executor.readFile("_remix_vary_metadata.json");
    metadata = VaryMetadataSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.error(`[agent-vary] _remix_vary_metadata.json missing or invalid: ${err}`);
  }

  return {
    applied: nonDefault,
    metadata,
    usage: {
      totalCostUsd: resultMessage.totalCostUsd,
      inputTokens: resultMessage.inputTokens,
      outputTokens: resultMessage.outputTokens,
      turns: resultMessage.turns,
      durationMs: resultMessage.durationMs,
    },
    verified,
    tscOutput,
    vitestOutput,
    sacredViolations,
  };
}

// ── Sacred-anchor protection ─────────────────────────────────────

type SacredSnapshot = {
  filePaths: Set<string>;
  dataTestIdsByPath: Map<string, Set<string>>;
};

const DATA_TESTID_RE = /data-testid\s*=\s*["']([^"']+)["']/g;
const GETBY_TESTID_RE = /getByTestId\(\s*["']([^"']+)["']\s*\)/g;

async function captureSacredAnchors(
  executor: RepoExecutor,
  manifest: Manifest,
): Promise<SacredSnapshot> {
  const filePaths = new Set(manifest.files.map((f) => f.path));
  const dataTestIdsByPath = new Map<string, Set<string>>();

  for (const entry of manifest.files) {
    if (!entry.adapt) continue;
    try {
      const content = await executor.readFile(entry.path);
      const ids = new Set<string>();
      for (const m of content.matchAll(DATA_TESTID_RE)) ids.add(m[1]);
      for (const m of content.matchAll(GETBY_TESTID_RE)) ids.add(m[1]);
      if (ids.size > 0) dataTestIdsByPath.set(entry.path, ids);
    } catch {
      /* file missing — ignore */
    }
  }

  return { filePaths, dataTestIdsByPath };
}

function diffSacredAnchors(
  before: SacredSnapshot,
  after: SacredSnapshot,
): string[] {
  const violations: string[] = [];

  // Path existence
  for (const path of before.filePaths) {
    if (!after.filePaths.has(path)) {
      violations.push(`sacred file removed: ${path}`);
    }
  }

  // data-testid presence (a renamed/removed testid is the failure mode)
  for (const [path, ids] of before.dataTestIdsByPath) {
    const afterIds = after.dataTestIdsByPath.get(path) ?? new Set();
    for (const id of ids) {
      if (!afterIds.has(id)) {
        violations.push(`data-testid removed/renamed in ${path}: "${id}"`);
      }
    }
  }

  return violations;
}
