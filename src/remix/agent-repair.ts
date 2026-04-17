import { query } from "@anthropic-ai/claude-agent-sdk";
import { RepoExecutor } from "../validation/index.js";
import type { Manifest } from "../skeletons/types.js";
import type { Brief } from "./types.js";
import { combineOutput } from "./agent-adapt.js";
import { buildRepairSystemPrompt, buildRepairUserPrompt } from "./agent-prompts.js";

export interface AgentRepairResult {
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
}

const REPAIR_MODEL = "claude-sonnet-4-6";
const REPAIR_MAX_TURNS = 20;
const REPAIR_MAX_BUDGET_USD = 0.5;

/**
 * Run a narrow repair agent against a workspace that the primary agentAdapt
 * already edited but left failing tsc or vitest. The repair agent gets the
 * error output in its prompt and a narrower tool/budget envelope than the
 * primary agent.
 */
export async function agentRepair(
  executor: RepoExecutor,
  brief: Brief,
  manifest: Manifest,
  tscOutput: string,
  vitestOutput: string,
): Promise<AgentRepairResult> {
  const systemPrompt = buildRepairSystemPrompt();
  const userPrompt = buildRepairUserPrompt(brief, manifest, tscOutput, vitestOutput);

  console.error(`[agent-repair] Starting repair agent in ${executor.dir}`);

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
        model: REPAIR_MODEL,
        systemPrompt,
        cwd: executor.dir,
        maxTurns: REPAIR_MAX_TURNS,
        maxBudgetUsd: REPAIR_MAX_BUDGET_USD,
        allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        settingSources: [],
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("name" in block) {
            console.error(`[agent-repair]   tool: ${block.name}`);
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
          `[agent-repair] Repair done: ${message.subtype} | ${message.num_turns} turns | $${message.total_cost_usd.toFixed(3)}`,
        );
      }
    }
  } catch (err) {
    if (resultMessage) {
      console.error(`[agent-repair] Stream error after completion (ignored): ${err}`);
    } else {
      throw err;
    }
  }

  if (!resultMessage) {
    throw new Error("Repair agent returned no result message");
  }

  const usage = {
    totalCostUsd: resultMessage.totalCostUsd,
    inputTokens: resultMessage.inputTokens,
    outputTokens: resultMessage.outputTokens,
    turns: resultMessage.turns,
    durationMs: resultMessage.durationMs,
  };

  // A repair agent that crashed out with isError still had effect on disk.
  // Re-run the gate regardless and let the verification decide the outcome.
  if (resultMessage.isError) {
    console.error(`[agent-repair] Agent ended with error subtype=${resultMessage.subtype}; re-running gate anyway`);
  }

  console.error(`[agent-repair] Re-running verification gate...`);
  const tscResult = await executor.tscCheck();
  const vitestResult = await executor.vitestRun();
  const verified = tscResult.exitCode === 0 && vitestResult.exitCode === 0;
  const nextTscOutput = tscResult.exitCode === 0 ? "" : combineOutput(tscResult.stdout, tscResult.stderr);
  const nextVitestOutput = vitestResult.exitCode === 0 ? "" : combineOutput(vitestResult.stdout, vitestResult.stderr);

  if (verified) {
    console.error(`[agent-repair] Verification passed after repair`);
  } else {
    console.error(
      `[agent-repair] Verification STILL failing — tsc=${tscResult.exitCode === 0} vitest=${vitestResult.exitCode === 0}`,
    );
  }

  return {
    usage,
    verified,
    tscOutput: nextTscOutput,
    vitestOutput: nextVitestOutput,
  };
}
