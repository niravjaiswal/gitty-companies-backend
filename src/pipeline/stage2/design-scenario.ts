import { callLlm, tryParseJson } from "../../app/external/llm/client.js";
import {
  JsonParseError,
  SchemaValidationError,
  CoherenceValidationError,
} from "../../app/external/llm/errors.js";
import type { LlmCallConfig, LlmMessage } from "../../app/external/llm/types.js";
import type { AssessmentSpec } from "../stage1/spec-schema.js";
import { ScenarioDesignSchema, type ScenarioDesign } from "./scenario-schema.js";
import { STAGE2_SYSTEM_PROMPT, buildStage2UserPrompt } from "./prompts.js";
import { validateCoherence } from "./validate-coherence.js";

const SONNET_MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 8192;

export async function designScenario(
  spec: AssessmentSpec,
): Promise<ScenarioDesign> {
  const messages: LlmMessage[] = [
    { role: "user", content: buildStage2UserPrompt(spec) },
  ];

  const config: LlmCallConfig = {
    model: SONNET_MODEL,
    maxTokens: MAX_TOKENS,
    system: STAGE2_SYSTEM_PROMPT,
    messages,
    temperature: 0.7,
  };

  // Step 1: Initial LLM call
  let result = await callLlm(config);

  // Step 2: JSON parse + Zod validation with 1 retry on either failure
  let design: ScenarioDesign;

  try {
    const parsed = tryParseJson(result.content);
    const zodResult = ScenarioDesignSchema.safeParse(parsed);
    if (!zodResult.success) throw zodResult.error;
    design = zodResult.data;
  } catch {
    messages.push(
      { role: "assistant", content: result.content },
      {
        role: "user",
        content:
          "Your previous response was not valid JSON or did not match the required schema. The JSON must have these exact top-level keys: scenario, starter_repo, candidate_tasks, evaluation_rubric, readme_structure. Respond with ONLY the corrected JSON object.",
      },
    );
    result = await callLlm(config);

    let parsed: unknown;
    try {
      parsed = tryParseJson(result.content);
    } catch (e) {
      throw new JsonParseError(
        result.content,
        e instanceof Error ? e : undefined,
      );
    }

    const zodResult = ScenarioDesignSchema.safeParse(parsed);
    if (!zodResult.success) {
      throw new SchemaValidationError(
        `LLM response failed schema validation: ${zodResult.error.message}`,
        zodResult.error,
        parsed,
      );
    }
    design = zodResult.data;
  }

  // Step 3: Coherence validation with up to 2 repair attempts
  let coherence = validateCoherence(design, spec);

  for (let attempt = 0; attempt < 2 && !coherence.valid; attempt++) {
    const errorList = coherence.errors
      .map((e, i) => `${i + 1}. ${e}`)
      .join("\n");

    messages.push(
      { role: "assistant", content: result.content },
      {
        role: "user",
        content: `Your previous output had these structural issues:\n${errorList}\n\nFix ONLY these issues in your JSON output. Keep everything else identical. Respond with the complete corrected JSON.`,
      },
    );

    result = await callLlm(config);

    let reparsed: unknown;
    try {
      reparsed = tryParseJson(result.content);
    } catch {
      continue;
    }

    const repairZod = ScenarioDesignSchema.safeParse(reparsed);
    if (!repairZod.success) continue;

    design = repairZod.data;
    coherence = validateCoherence(design, spec);
  }

  if (!coherence.valid) {
    throw new CoherenceValidationError(
      "Coherence validation failed after 2 repair attempts",
      coherence.errors,
      result.content,
    );
  }

  return design;
}
