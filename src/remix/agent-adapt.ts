import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { RepoExecutor } from "../validation/index.js";
import type { Manifest } from "../skeletons/types.js";
import type { Brief, RemixedWorkspace } from "./types.js";
import { buildAgentSystemPrompt, buildAgentUserPrompt } from "./agent-prompts.js";

// ── Metadata schema (what the agent writes to _remix_metadata.json) ──

const MetadataSchema = z.object({
  scenario: z.object({
    title: z.string().min(1),
    company_name: z.string().min(1),
    narrative: z.string().min(1),
  }),
  tasks: z
    .array(z.object({ title: z.string().min(1), description: z.string().min(1) }))
    .min(1),
  rubric: z
    .array(z.object({ criterion: z.string().min(1), weight: z.number().min(0).max(1) }))
    .min(1),
});

type Metadata = z.infer<typeof MetadataSchema>;

// ── Result type ─────────────────────────────────────────────────

export interface AgentAdaptResult {
  workspace: RemixedWorkspace;
  usage: {
    totalCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    turns: number;
    durationMs: number;
  };
  verified: boolean;
}

// ── Agent configuration ─────────────────────────────────────────

const AGENT_MODEL = "claude-sonnet-4-6";
const MAX_TURNS = 45;
const MAX_BUDGET_USD = 1.5;

// ── Core function ───────────────────────────────────────────────

/**
 * Run an agent that adapts a skeleton workspace for a target company.
 *
 * The agent edits files in-place, runs tsc/vitest, self-heals, and writes
 * metadata. After the agent finishes we run our own verification gate.
 */
export async function agentAdapt(
  executor: RepoExecutor,
  brief: Brief,
  manifest: Manifest,
): Promise<AgentAdaptResult> {
  // Pre-load adaptable file contents so the agent doesn't need to read them
  const adaptPaths = manifest.files.filter((f) => f.adapt).map((f) => f.path);
  const adaptFilesMap = await executor.readAllFiles(adaptPaths);
  const fileContents: Record<string, string> = {};
  for (const [path, content] of adaptFilesMap) {
    fileContents[path] = content;
  }

  const systemPrompt = buildAgentSystemPrompt();
  const userPrompt = buildAgentUserPrompt(brief, manifest, fileContents);

  console.error(`[agent-adapt] Starting agent in ${executor.dir}`);

  // ── Run agent ──────────────────────────────────────────────
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
            console.error(`[agent-adapt]   tool: ${block.name}`);
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
          `[agent-adapt] Agent done: ${message.subtype} | ${message.num_turns} turns | $${message.total_cost_usd.toFixed(3)}`,
        );
      }
    }
  } catch (err) {
    if (resultMessage) {
      // Agent completed but stream cleanup failed — continue with what we have
      console.error(`[agent-adapt] Stream error after completion (ignored): ${err}`);
    } else {
      throw err;
    }
  }

  if (!resultMessage) {
    throw new Error("Agent returned no result message");
  }

  if (resultMessage.isError) {
    throw new Error(`Agent ended with error: ${resultMessage.subtype}`);
  }

  // ── Read metadata ──────────────────────────────────────────
  const metadata = await readMetadata(executor, brief);

  // ── Read all files back from workspace ─────────────────────
  const filePaths = manifest.files.map((f) => f.path);
  const filesMap = await executor.readAllFiles(filePaths);
  const files: Record<string, string> = {};
  for (const [path, content] of filesMap) {
    files[path] = content;
  }

  // ── Post-agent verification gate ───────────────────────────
  console.error(`[agent-adapt] Running post-agent verification...`);
  const tscResult = await executor.tscCheck();
  const vitestResult = await executor.vitestRun();
  const verified = tscResult.exitCode === 0 && vitestResult.exitCode === 0;

  if (!verified) {
    const tscErrors = tscResult.exitCode !== 0 ? (tscResult.stdout || tscResult.stderr).slice(0, 300) : "";
    const vitestErrors = vitestResult.exitCode !== 0 ? (vitestResult.stderr || vitestResult.stdout).slice(0, 300) : "";
    console.error(
      `[agent-adapt] Verification FAILED — tsc=${tscResult.exitCode === 0} vitest=${vitestResult.exitCode === 0}`,
    );
    if (tscErrors) console.error(`[agent-adapt]   tsc: ${tscErrors}`);
    if (vitestErrors) console.error(`[agent-adapt]   vitest: ${vitestErrors}`);
  } else {
    console.error(`[agent-adapt] Verification passed`);
  }

  return {
    workspace: {
      files,
      scenario: metadata.scenario,
      tasks: metadata.tasks,
      rubric: metadata.rubric,
    },
    usage: {
      totalCostUsd: resultMessage.totalCostUsd,
      inputTokens: resultMessage.inputTokens,
      outputTokens: resultMessage.outputTokens,
      turns: resultMessage.turns,
      durationMs: resultMessage.durationMs,
    },
    verified,
  };
}

// ── Metadata extraction ─────────────────────────────────────────

async function readMetadata(executor: RepoExecutor, brief: Brief): Promise<Metadata> {
  try {
    const raw = await executor.readFile("_remix_metadata.json");
    const parsed = JSON.parse(raw);
    return MetadataSchema.parse(parsed);
  } catch (err) {
    console.error(`[agent-adapt] Metadata missing or invalid, using fallback: ${err}`);
    return fallbackMetadata(brief);
  }
}

function fallbackMetadata(brief: Brief): Metadata {
  return {
    scenario: {
      title: `${brief.company_name} Assessment`,
      company_name: brief.company_name,
      narrative: `A coding assessment tailored for the ${brief.role_title} role at ${brief.company_name}.`,
    },
    tasks: [
      {
        title: "Implement the required feature",
        description: `Complete the implementation as described in the README, following ${brief.company_name}'s domain context.`,
      },
    ],
    rubric: [
      { criterion: "Correctness", weight: 0.3 },
      { criterion: "Code quality", weight: 0.25 },
      { criterion: "TypeScript proficiency", weight: 0.25 },
      { criterion: "Testing awareness", weight: 0.2 },
    ],
  };
}
