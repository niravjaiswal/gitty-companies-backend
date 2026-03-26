import { callLlm } from "../../app/external/llm/client.js";
import type { AssessmentSpec } from "../stage1/spec-schema.js";
import type { ScenarioDesign } from "../stage2/scenario-schema.js";
import type { GenerateRepoResult } from "../stage3/generate-repo.js";
import { buildStage5UserPrompt } from "./build-prompt.js";
import { STAGE5_SYSTEM_PROMPT } from "./prompts.js";
import { validatePrdMarkdown } from "./validate-prd.js";

const SONNET_MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;

export interface GeneratePrdResult {
  markdown: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
}

export async function generatePrd(
  spec: AssessmentSpec,
  scenario: ScenarioDesign,
  repo: GenerateRepoResult,
): Promise<GeneratePrdResult> {
  const prompt = buildStage5UserPrompt(spec, scenario, repo);
  const result = await callLlm({
    model: SONNET_MODEL,
    maxTokens: MAX_TOKENS,
    system: STAGE5_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
  });

  const markdown = result.content.trim();
  const validation = validatePrdMarkdown(markdown, scenario.scenario.title);

  if (!validation.valid) {
    throw new Error(
      `Stage 5 PRD generation failed validation: ${validation.errors.join("; ")}`,
    );
  }

  return {
    markdown,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    stopReason: result.stopReason,
  };
}
