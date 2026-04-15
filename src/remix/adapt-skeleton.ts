import { callLlmForJson } from "../app/external/llm/client.js";
import { SchemaValidationError } from "../app/external/llm/errors.js";
import type { LlmCallConfig } from "../app/external/llm/types.js";
import { RemixPatchSchema } from "../skeletons/types.js";
import type { LoadedSkeleton, RemixPatch } from "../skeletons/types.js";
import type { Brief, TokenUsage } from "./types.js";
import { ADAPT_SYSTEM_PROMPT, buildAdaptPrompt } from "./adapt-skeleton-prompts.js";

const SONNET_MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 16384;

export async function adaptSkeleton(
  loaded: LoadedSkeleton,
  brief: Brief,
): Promise<{ patch: RemixPatch; usage: TokenUsage }> {
  // Build the set of adapt-true file paths and their contents
  const adaptEntries = loaded.manifest.files.filter((f) => f.adapt);
  const adaptPaths = new Set(adaptEntries.map((f) => f.path));
  const adaptFiles = new Map<string, string>();
  for (const entry of adaptEntries) {
    const content = loaded.files[entry.path];
    if (content !== undefined) {
      adaptFiles.set(entry.path, content);
    }
  }

  const userPrompt = buildAdaptPrompt(
    loaded.skeleton,
    loaded.manifest,
    brief,
    adaptFiles,
  );

  const config: LlmCallConfig = {
    model: SONNET_MODEL,
    maxTokens: MAX_TOKENS,
    system: ADAPT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  };

  const { parsed, result } = await callLlmForJson(config);
  const validationResult = RemixPatchSchema.safeParse(parsed);

  if (!validationResult.success) {
    // One retry: feed the errors back to the LLM
    console.error("  adapt-skeleton: Initial parse failed, retrying with error feedback...");
    const retryConfig: LlmCallConfig = {
      ...config,
      messages: [
        { role: "user", content: userPrompt },
        { role: "assistant", content: JSON.stringify(parsed) },
        {
          role: "user",
          content: `Your response had validation errors:\n${validationResult.error.message}\n\nPlease fix these errors and respond with corrected JSON only.`,
        },
      ],
    };
    const { parsed: retryParsed, result: retryResult } = await callLlmForJson(retryConfig);
    const retryValidation = RemixPatchSchema.safeParse(retryParsed);

    if (!retryValidation.success) {
      throw new SchemaValidationError(
        `LLM response failed schema validation after retry: ${retryValidation.error.message}`,
        retryValidation.error,
        retryParsed,
      );
    }

    // Post-validation: check patch paths against adapt-true set
    const invalidPaths = retryValidation.data.file_patches
      .filter((p) => !adaptPaths.has(p.path))
      .map((p) => p.path);
    if (invalidPaths.length > 0) {
      throw new SchemaValidationError(
        `Patch contains files not marked adapt: true: ${invalidPaths.join(", ")}`,
        null,
        retryParsed,
      );
    }

    return {
      patch: retryValidation.data,
      usage: {
        inputTokens: retryResult.inputTokens,
        outputTokens: retryResult.outputTokens,
        model: retryResult.model,
      },
    };
  }

  // Post-validation: check patch paths against adapt-true set
  const invalidPaths = validationResult.data.file_patches
    .filter((p) => !adaptPaths.has(p.path))
    .map((p) => p.path);
  if (invalidPaths.length > 0) {
    // Retry with path feedback
    console.error("  adapt-skeleton: Patch contains invalid paths, retrying with feedback...");
    const retryConfig: LlmCallConfig = {
      ...config,
      messages: [
        { role: "user", content: userPrompt },
        { role: "assistant", content: JSON.stringify(parsed) },
        {
          role: "user",
          content: `Your response includes patches for files not marked adapt: true: ${invalidPaths.join(", ")}\n\nOnly these files are adaptable: ${[...adaptPaths].join(", ")}\n\nPlease fix and respond with corrected JSON only.`,
        },
      ],
    };
    const { parsed: retryParsed, result: retryResult } = await callLlmForJson(retryConfig);
    const retryValidation = RemixPatchSchema.safeParse(retryParsed);

    if (!retryValidation.success) {
      throw new SchemaValidationError(
        `LLM response failed schema validation after retry: ${retryValidation.error.message}`,
        retryValidation.error,
        retryParsed,
      );
    }

    const retryInvalidPaths = retryValidation.data.file_patches
      .filter((p) => !adaptPaths.has(p.path))
      .map((p) => p.path);
    if (retryInvalidPaths.length > 0) {
      throw new SchemaValidationError(
        `Patch still contains files not marked adapt: true after retry: ${retryInvalidPaths.join(", ")}`,
        null,
        retryParsed,
      );
    }

    return {
      patch: retryValidation.data,
      usage: {
        inputTokens: retryResult.inputTokens,
        outputTokens: retryResult.outputTokens,
        model: retryResult.model,
      },
    };
  }

  return {
    patch: validationResult.data,
    usage: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      model: result.model,
    },
  };
}
