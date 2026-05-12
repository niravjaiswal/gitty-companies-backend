import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callLlmForJson } from "../../../app/external/llm/client.js";
import type { AdversarialSource } from "./source.js";
import type { FileDiff } from "./sandbox.js";
import type { DecisionObservation, HardcodingObservation } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPT_PATH = join(__dirname, "prompts", "verdict.md");

const DEFAULT_MODEL = "claude-sonnet-4-6";

type JudgeRawResponse = {
  decisions?: Array<{
    description?: string;
    category?: string;
    alternativeConsidered?: string;
  }>;
  hardcoding?: { detected?: boolean; evidence?: string };
  reasoning?: string;
};

export type JudgeResult = {
  decisions: DecisionObservation[];
  hardcoding: HardcodingObservation;
  reasoning: string;
};

export async function judgeRun(args: {
  source: AdversarialSource;
  diff: FileDiff;
  finalText: string;
  testsPassed: boolean;
  model?: string;
}): Promise<JudgeResult> {
  const rubric = await readFile(PROMPT_PATH, "utf-8");
  const context = buildJudgeContext(args);

  const { parsed } = await callLlmForJson<JudgeRawResponse>({
    model: args.model ?? DEFAULT_MODEL,
    maxTokens: 2000,
    system: rubric,
    messages: [{ role: "user", content: context }],
    temperature: 0.3,
  });

  return normalizeJudge(parsed);
}

function buildJudgeContext(args: {
  source: AdversarialSource;
  diff: FileDiff;
  finalText: string;
  testsPassed: boolean;
}): string {
  const readme = args.source.readme;

  const testFileBodies = args.source.manifest.files
    .filter((f) => /\.test\.|__tests__\//.test(f.path))
    .map((f) => `### ${f.path}\n\n\`\`\`\n${args.source.files[f.path] ?? ""}\n\`\`\`\n`)
    .join("\n");

  const fixtureBodies = args.source.manifest.files
    .filter((f) => /data\.ts$|fixtures?\.|seed\./.test(f.path))
    .map((f) => `### ${f.path}\n\n\`\`\`\n${args.source.files[f.path] ?? ""}\n\`\`\`\n`)
    .join("\n");

  const diffsRendered = Object.entries(args.diff.diffsByPath)
    .map(([path, { before, after }]) => {
      return `### ${path}\n\n**BEFORE**\n\n\`\`\`\n${before}\n\`\`\`\n\n**AFTER**\n\n\`\`\`\n${after}\n\`\`\`\n`;
    })
    .join("\n");

  return [
    `# Task README\n\n${readme}\n`,
    `# Tests (define correct behavior)\n\n${testFileBodies}\n`,
    fixtureBodies ? `# Fixtures\n\n${fixtureBodies}\n` : "",
    `# Agent's final diff\n\n${diffsRendered}\n`,
    `# Run outcome\n\nTests passed: ${args.testsPassed}\n\nAgent's final message:\n\n${args.finalText.slice(0, 4000)}\n`,
  ].join("\n");
}

function normalizeJudge(raw: JudgeRawResponse): JudgeResult {
  const decisions: DecisionObservation[] = (raw.decisions ?? []).map((d) => {
    const cat = d.category ?? "mechanical";
    const normalized: DecisionObservation["category"] =
      cat === "judgment_call" || cat === "architectural" || cat === "mechanical"
        ? cat
        : "mechanical";
    return {
      description: d.description ?? "",
      category: normalized,
      alternativeConsidered: d.alternativeConsidered || undefined,
    };
  });

  const hardcoding: HardcodingObservation = {
    detected: Boolean(raw.hardcoding?.detected),
    evidence: raw.hardcoding?.evidence ?? "",
  };

  return { decisions, hardcoding, reasoning: raw.reasoning ?? "" };
}
