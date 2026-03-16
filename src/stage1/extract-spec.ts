import { callLlmForJson } from "../llm/client.js";
import { SchemaValidationError } from "../llm/errors.js";
import type { LlmCallConfig } from "../llm/types.js";
import { AssessmentSpecSchema, type AssessmentSpec } from "./spec-schema.js";
import { STAGE1_SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 2048;

export async function extractSpec(
  rawDescription: string,
): Promise<AssessmentSpec> {
  const config: LlmCallConfig = {
    model: HAIKU_MODEL,
    maxTokens: MAX_TOKENS,
    system: STAGE1_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(rawDescription) }],
  };

  const { parsed } = await callLlmForJson(config);
  const result = AssessmentSpecSchema.safeParse(parsed);

  if (!result.success) {
    throw new SchemaValidationError(
      `LLM response failed schema validation: ${result.error.message}`,
      result.error,
      parsed,
    );
  }

  return result.data;
}
