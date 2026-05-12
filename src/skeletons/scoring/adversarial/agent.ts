import { query } from "@anthropic-ai/claude-agent-sdk";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SandboxHandle } from "./sandbox.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TRANSCRIPT_DIR = join(__dirname, "transcripts");

const DEFAULT_MODEL = "claude-sonnet-4-6";

const SOLVER_AGENT_PROMPT = `You are a competent junior-to-mid full-stack engineer taking a technical assessment.

You have been given a partially complete project. Your job:
1. Read the README at the repo root to understand the task.
2. Explore the codebase enough to understand the structure and where the work goes.
3. Implement what the README asks for.
4. Run the tests (\`npx vitest run\`) and make sure they pass before you finish.
5. Stop when tests pass — do not over-engineer or add features the README did not ask for.

Constraints:
- Modify only files that the README/task scope says you should change. Generally that means non-test source files. Do NOT modify the test files themselves to make tests pass.
- Do NOT modify package.json, vite.config, tsconfig, or other build files unless the task explicitly requires it.
- When the tests pass, state "DONE" and stop.

Style:
- Make real engineering decisions. If the task involves a choice between approaches, pick one and explain briefly why in your final message.
- Keep changes minimal and aligned with existing code conventions.`;

export type SolverRunResult = {
  turnsUsed: number;
  numEdits: number;
  costUsd: number;
  finalText: string;
  stopReason: string;
  transcriptPath: string;
  rawError?: string;
};

export async function runSolverAgent(
  handle: SandboxHandle,
  maxTurns: number,
  model: string = DEFAULT_MODEL,
): Promise<SolverRunResult> {
  await mkdir(TRANSCRIPT_DIR, { recursive: true });
  const transcriptPath = join(TRANSCRIPT_DIR, `${handle.runId}.jsonl`);

  let turnsUsed = 0;
  let numEdits = 0;
  let costUsd = 0;
  let finalText = "";
  let stopReason = "unknown";
  let rawError: string | undefined;

  const q = query({
    prompt:
      "Read the README at the repo root and complete the assessment task. Run `npx vitest run` to validate before you finish. Say DONE when tests pass.",
    options: {
      cwd: handle.dir,
      additionalDirectories: [handle.dir],
      model,
      maxTurns,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      tools: { type: "preset", preset: "claude_code" },
      agents: {
        solver: {
          description: "Solver agent for adversarial skeleton evaluation",
          prompt: SOLVER_AGENT_PROMPT,
          model,
        },
      },
      agent: "solver",
    },
  });

  try {
    for await (const msg of q) {
      await appendFile(transcriptPath, JSON.stringify(msg) + "\n");

      if (msg.type === "assistant") {
        const blocks = (msg as { message?: { content?: unknown[] } }).message?.content ?? [];
        for (const b of blocks) {
          const block = b as { type?: string; name?: string; text?: string };
          if (block.type === "tool_use") {
            if (block.name === "Write" || block.name === "Edit" || block.name === "MultiEdit") {
              numEdits += 1;
            }
          } else if (block.type === "text" && block.text) {
            finalText = block.text;
          }
        }
      }

      if (msg.type === "result") {
        const r = msg as {
          subtype?: string;
          num_turns?: number;
          total_cost_usd?: number;
          stop_reason?: string | null;
          is_error?: boolean;
          result?: string;
        };
        turnsUsed = r.num_turns ?? turnsUsed;
        costUsd = r.total_cost_usd ?? 0;
        stopReason = r.stop_reason ?? r.subtype ?? "unknown";
        if (r.is_error) rawError = r.result ?? "agent reported error";
        if (r.result) finalText = r.result;
      }
    }
  } catch (err) {
    rawError = err instanceof Error ? err.message : String(err);
  }

  return {
    turnsUsed,
    numEdits,
    costUsd,
    finalText,
    stopReason,
    transcriptPath,
    rawError,
  };
}
