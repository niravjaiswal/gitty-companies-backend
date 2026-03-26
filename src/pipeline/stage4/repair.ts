import { callLlm } from "../../app/external/llm/client.js";
import { stripMarkdownFences } from "../stage3/validate-file.js";
import {
  STAGE4_REPAIR_SYSTEM_PROMPT,
  buildTscRepairPrompt,
  buildTestRepairPrompt,
} from "./prompts.js";

const SONNET_MODEL = "claude-sonnet-4-20250514";

export async function repairTscError(
  filePath: string,
  fileContent: string,
  errors: string[],
): Promise<string> {
  const prompt = buildTscRepairPrompt(filePath, fileContent, errors);
  const result = await callLlm({
    model: SONNET_MODEL,
    maxTokens: 4096,
    system: STAGE4_REPAIR_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
  });
  return stripMarkdownFences(result.content);
}

export async function repairTestFailure(
  implFilePath: string,
  implFileContent: string,
  testFilePath: string,
  testFileContent: string,
  failureMessages: string[],
): Promise<string> {
  const prompt = buildTestRepairPrompt(
    implFilePath,
    implFileContent,
    testFilePath,
    testFileContent,
    failureMessages,
  );
  const result = await callLlm({
    model: SONNET_MODEL,
    maxTokens: 4096,
    system: STAGE4_REPAIR_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
  });
  return stripMarkdownFences(result.content);
}
