import Anthropic from "@anthropic-ai/sdk";
import type { LlmCallConfig, LlmCallResult, LlmMessage } from "./types.js";
import { JsonParseError } from "./errors.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export async function callLlm(config: LlmCallConfig): Promise<LlmCallResult> {
  const stream = getClient().messages.stream({
    model: config.model,
    max_tokens: config.maxTokens,
    system: config.system,
    messages: config.messages,
    temperature: config.temperature ?? 0,
  });
  const response = await stream.finalMessage();

  const firstBlock = response.content[0];
  const content = firstBlock.type === "text" ? firstBlock.text : "";

  return {
    content,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: response.model,
    stopReason: response.stop_reason ?? "unknown",
  };
}

export function tryParseJson(text: string): unknown {
  // Strip markdown code fences if present
  const stripped = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
  return JSON.parse(stripped);
}

export async function callLlmForJson<T = unknown>(
  config: LlmCallConfig,
): Promise<{ parsed: T; result: LlmCallResult }> {
  const result = await callLlm(config);

  try {
    const parsed = tryParseJson(result.content) as T;
    return { parsed, result };
  } catch {
    // Retry once with repair prompt
    const retryMessages: LlmMessage[] = [
      ...config.messages,
      { role: "assistant", content: result.content },
      { role: "user", content: "Your previous response was not valid JSON. Respond with ONLY a JSON object." },
    ];

    const retryResult = await callLlm({ ...config, messages: retryMessages });

    try {
      const parsed = tryParseJson(retryResult.content) as T;
      return { parsed, result: retryResult };
    } catch (e) {
      throw new JsonParseError(retryResult.content, e instanceof Error ? e : undefined);
    }
  }
}
