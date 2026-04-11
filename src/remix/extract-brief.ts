import { callLlmForJson } from "../app/external/llm/client.js";
import { SchemaValidationError } from "../app/external/llm/errors.js";
import type { LlmCallConfig } from "../app/external/llm/types.js";
import { BriefSchema, type Brief, type TokenUsage } from "./types.js";
import {
  EXTRACT_BRIEF_SYSTEM_PROMPT,
  buildExtractBriefPrompt,
} from "./extract-brief-prompts.js";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;

/**
 * Normalize common seniority aliases to canonical values.
 */
const SENIORITY_ALIASES: Record<string, string> = {
  sr: "senior",
  "sr.": "senior",
  jr: "junior",
  "jr.": "junior",
  intermediate: "mid",
  middle: "mid",
  lead: "staff",
  principal: "staff",
};

function coerceBrief(raw: Record<string, unknown>): Record<string, unknown> {
  if (typeof raw.seniority === "string") {
    const normalized = raw.seniority.trim().toLowerCase();
    raw.seniority = SENIORITY_ALIASES[normalized] ?? normalized;
  }
  return raw;
}

export async function extractBrief(
  jobBriefText: string,
): Promise<{ brief: Brief; usage: TokenUsage }> {
  const config: LlmCallConfig = {
    model: HAIKU_MODEL,
    maxTokens: MAX_TOKENS,
    temperature: 0,
    system: EXTRACT_BRIEF_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildExtractBriefPrompt(jobBriefText) }],
  };

  const { parsed, result } = await callLlmForJson(config);
  const coerced = coerceBrief(parsed as Record<string, unknown>);
  const parseResult = BriefSchema.safeParse(coerced);

  if (!parseResult.success) {
    // One retry: feed the errors back to the LLM
    console.error(
      "  extract-brief: Initial parse failed, retrying with error feedback...",
    );
    const retryConfig: LlmCallConfig = {
      ...config,
      messages: [
        { role: "user", content: buildExtractBriefPrompt(jobBriefText) },
        { role: "assistant", content: JSON.stringify(parsed) },
        {
          role: "user",
          content: `Your response had validation errors:\n${parseResult.error.message}\n\nPlease fix these errors and respond with corrected JSON only.`,
        },
      ],
    };
    const { parsed: retryParsed, result: retryResult } =
      await callLlmForJson(retryConfig);
    const retryCoerced = coerceBrief(retryParsed as Record<string, unknown>);
    const retryParseResult = BriefSchema.safeParse(retryCoerced);

    if (!retryParseResult.success) {
      throw new SchemaValidationError(
        `LLM response failed Brief schema validation after retry: ${retryParseResult.error.message}`,
        retryParseResult.error,
        retryParsed,
      );
    }

    return {
      brief: retryParseResult.data,
      usage: {
        inputTokens: retryResult.inputTokens,
        outputTokens: retryResult.outputTokens,
        model: retryResult.model,
      },
    };
  }

  return {
    brief: parseResult.data,
    usage: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      model: result.model,
    },
  };
}
