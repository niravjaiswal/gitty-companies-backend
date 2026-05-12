import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { callLlmForJson } from "../../../app/external/llm/client.js";
import type { LoadedSkeleton } from "../../types.js";
import type { DimId, DimScore } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROMPT_DIR = join(__dirname, "..", "prompts");

const DEFAULT_MODEL = "claude-sonnet-4-6";

type LlmJudgeResult = {
  score: number;
  reasoning?: string;
  [key: string]: unknown;
};

function buildContext(loaded: LoadedSkeleton): string {
  const readme = loaded.files["README.md"] ?? "";
  const skeletonMeta = JSON.stringify(loaded.skeleton, null, 2);
  const manifest = JSON.stringify(loaded.manifest, null, 2);

  const adaptablePaths = loaded.manifest.files
    .filter((f) => f.adapt)
    .map((f) => f.path)
    .filter((p) => /\.(ts|tsx|md)$/.test(p));

  const fileBodies = adaptablePaths
    .map((p) => `### ${p}\n\n\`\`\`\n${loaded.files[p] ?? ""}\n\`\`\`\n`)
    .join("\n");

  return [
    `# Skeleton: ${loaded.skeleton.name}\n`,
    `## skeleton.json\n\n\`\`\`json\n${skeletonMeta}\n\`\`\`\n`,
    `## manifest.json\n\n\`\`\`json\n${manifest}\n\`\`\`\n`,
    `## README.md\n\n${readme}\n`,
    `## Adaptable source files\n\n${fileBodies}`,
  ].join("\n");
}

export async function llmDimScore(
  loaded: LoadedSkeleton,
  promptFile: string,
  dimId: DimId,
  options: { samples: number; model?: string },
): Promise<DimScore> {
  const rubric = await readFile(join(PROMPT_DIR, promptFile), "utf-8");
  const context = buildContext(loaded);
  const model = options.model ?? DEFAULT_MODEL;

  const samples: LlmJudgeResult[] = [];
  for (let i = 0; i < options.samples; i++) {
    const { parsed } = await callLlmForJson<LlmJudgeResult>({
      model,
      maxTokens: 2000,
      system: rubric,
      messages: [{ role: "user", content: context }],
      temperature: 0.4,
    });
    samples.push(parsed);
  }

  const rawScores = samples.map((s) => clampScore(s.score));
  const mean = rawScores.reduce((a, b) => a + b, 0) / rawScores.length;
  const score = Math.round(mean) as 1 | 2 | 3 | 4 | 5;

  return {
    dim: dimId,
    score,
    evidence: {
      samples: rawScores,
      mean: Number(mean.toFixed(2)),
      reasoning: samples.map((s) => String(s.reasoning ?? "")),
    },
  };
}

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 3;
  return Math.max(1, Math.min(5, Math.round(v)));
}
