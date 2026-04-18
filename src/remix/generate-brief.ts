import { callLlm } from "../app/external/llm/client.js";
import type { LlmCallConfig, LlmMessage } from "../app/external/llm/types.js";
import type { TokenUsage } from "./types.js";
import {
  GENERATE_BRIEF_SYSTEM_PROMPT,
  buildGenerateBriefPrompt,
  letterForIndex,
  type GenerateBriefPromptInput,
} from "./generate-brief-prompts.js";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 2048;

function stripMarkdownFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:markdown|md)?\s*\n?/i, "")
    .replace(/\n?\s*```\s*$/i, "")
    .trim();
}

function hasSection(markdown: string, heading: string): boolean {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^## ${escaped}\\s*$`, "im");
  return pattern.test(markdown);
}

function validateBrief(markdown: string, partCount: number): string[] {
  const missing: string[] = [];
  if (!hasSection(markdown, "Overview")) missing.push("## Overview");
  if (!hasSection(markdown, "Company codebase")) missing.push("## Company codebase");
  for (let i = 0; i < partCount; i += 1) {
    const label = `Part ${letterForIndex(i)}`;
    if (!hasSection(markdown, label)) missing.push(`## ${label}`);
  }
  return missing;
}

function synthesizeFallback(
  content: string,
  input: GenerateBriefPromptInput,
): string {
  const { scenario, brief, tasks } = input;
  const title = scenario.title?.trim() || `${brief.company_name} Assessment`;
  const overview = scenario.narrative?.trim() || "Assessment scenario unavailable.";
  const taskBullets = tasks.length
    ? tasks.map((t) => `- ${t.title}: ${t.description}`).join("\n")
    : "- See workspace files for scope.";
  const body = content.trim() || taskBullets;
  return `# ${title}

## Overview

${overview}

## Company codebase

The workspace is scaffolded and runnable. Explore the files to see what's already implemented before making changes.

## Part A

${body}
`;
}

/**
 * Generate a candidate-facing instructions_md from the remixed workspace facts.
 * Single Haiku call with one retry on structural failure, then a safe fallback
 * so brief-generation problems never kill an otherwise-successful remix.
 */
export async function generateInstructionsBrief(
  input: GenerateBriefPromptInput,
): Promise<{ instructionsMd: string; usage: TokenUsage }> {
  const userPrompt = buildGenerateBriefPrompt(input);

  const config: LlmCallConfig = {
    model: HAIKU_MODEL,
    maxTokens: MAX_TOKENS,
    temperature: 0,
    system: GENERATE_BRIEF_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  };

  const first = await callLlm(config);
  const firstContent = stripMarkdownFences(first.content);
  const firstMissing = validateBrief(firstContent, input.partCount);

  if (firstMissing.length === 0) {
    return {
      instructionsMd: firstContent,
      usage: {
        inputTokens: first.inputTokens,
        outputTokens: first.outputTokens,
        model: first.model,
      },
    };
  }

  console.error(
    `[generate-brief] initial output missing sections: ${firstMissing.join(", ")} — retrying`,
  );

  const retryMessages: LlmMessage[] = [
    { role: "user", content: userPrompt },
    { role: "assistant", content: first.content },
    {
      role: "user",
      content: `Your previous response was missing required sections: ${firstMissing.join(", ")}. Re-emit the full document with all required sections present, in the exact order specified, using \`## \` headings. Emit ONLY the markdown document.`,
    },
  ];

  const retry = await callLlm({ ...config, messages: retryMessages });
  const retryContent = stripMarkdownFences(retry.content);
  const retryMissing = validateBrief(retryContent, input.partCount);

  if (retryMissing.length === 0) {
    return {
      instructionsMd: retryContent,
      usage: {
        inputTokens: retry.inputTokens,
        outputTokens: retry.outputTokens,
        model: retry.model,
      },
    };
  }

  console.error(
    `[generate-brief] retry still missing sections: ${retryMissing.join(", ")} — synthesizing fallback wrapping output as Part A`,
  );

  return {
    instructionsMd: synthesizeFallback(retryContent || firstContent, input),
    usage: {
      inputTokens: retry.inputTokens,
      outputTokens: retry.outputTokens,
      model: retry.model,
    },
  };
}
