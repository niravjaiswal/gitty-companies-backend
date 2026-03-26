import { callLlmForJson } from "../../app/external/llm/client.js";
import { SchemaValidationError } from "../../app/external/llm/errors.js";
import type { LlmCallConfig } from "../../app/external/llm/types.js";
import {
  AssessmentSpecSchema,
  SkillAxisEnum,
  EstimatedScopeEnum,
  type AssessmentSpec,
} from "./spec-schema.js";
import { STAGE1_SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 2048;

/**
 * Coerce common near-miss values that the LLM produces.
 * Haiku frequently invents skill axes like "authentication_authorization"
 * and scope values like "3-4 hours" that aren't in the enum.
 */
function coerceSpec(raw: Record<string, unknown>): Record<string, unknown> {
  const validAxes = new Set(SkillAxisEnum.options);
  const validScopes = EstimatedScopeEnum.options;

  // Coerce skill_axes: drop invalid values, map known aliases
  if (Array.isArray(raw.skill_axes)) {
    const AXIS_ALIASES: Record<string, string> = {
      authentication_authorization: "security_practices",
      authentication: "security_practices",
      authorization: "security_practices",
      auth: "security_practices",
      input_validation: "validation",
      data_validation: "validation",
      unit_testing: "testing_strategy",
      test_design: "testing_strategy",
      api_development: "api_design",
      rest_api_design: "api_design",
      database_management: "database_design",
      sql: "database_design",
      type_system: "type_safety",
      middleware_design: "architecture",
      routing: "api_design",
      crud_operations: "api_design",
    };

    raw.skill_axes = (raw.skill_axes as string[])
      .map((axis: string) => AXIS_ALIASES[axis] ?? axis)
      .filter((axis: string) => validAxes.has(axis as never));

    // Deduplicate after alias mapping
    raw.skill_axes = [...new Set(raw.skill_axes as string[])];
  }

  // Coerce estimated_scope: map non-standard ranges to nearest valid option
  if (typeof raw.estimated_scope === "string" && !validScopes.includes(raw.estimated_scope as never)) {
    const SCOPE_MAP: Record<string, string> = {
      "3-4 hours": "2-4 hours",
      "5-6 hours": "4-6 hours",
      "7-8 hours": "6-8 hours",
      "1-3 hours": "1-2 hours",
      "3-5 hours": "4-6 hours",
    };
    raw.estimated_scope = SCOPE_MAP[raw.estimated_scope] ?? raw.estimated_scope;
  }

  return raw;
}

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
  const coerced = coerceSpec(parsed as Record<string, unknown>);
  const result = AssessmentSpecSchema.safeParse(coerced);

  if (!result.success) {
    // One retry: feed the errors back to the LLM
    console.error("  Stage 1: Initial parse failed, retrying with error feedback...");
    const retryConfig: LlmCallConfig = {
      ...config,
      messages: [
        { role: "user", content: buildUserPrompt(rawDescription) },
        { role: "assistant", content: JSON.stringify(parsed) },
        {
          role: "user",
          content: `Your response had validation errors:\n${result.error.message}\n\nPlease fix these errors and respond with corrected JSON only. Use ONLY values from the taxonomies listed in your instructions.`,
        },
      ],
    };
    const { parsed: retryParsed } = await callLlmForJson(retryConfig);
    const retryCoerced = coerceSpec(retryParsed as Record<string, unknown>);
    const retryResult = AssessmentSpecSchema.safeParse(retryCoerced);

    if (!retryResult.success) {
      throw new SchemaValidationError(
        `LLM response failed schema validation after retry: ${retryResult.error.message}`,
        retryResult.error,
        retryParsed,
      );
    }

    return retryResult.data;
  }

  return result.data;
}
