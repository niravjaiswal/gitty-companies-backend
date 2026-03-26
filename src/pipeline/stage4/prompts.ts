export const STAGE4_REPAIR_SYSTEM_PROMPT = `You are a senior software engineer fixing compilation or test errors in a TypeScript project.

## Rules

- Output ONLY the complete corrected source file.
- Do NOT wrap your output in markdown code fences.
- Do NOT include any explanation before or after the code.
- Preserve the file's original intent, exports, and structure.
- Fix only the reported errors — do not refactor unrelated code.
- Use explicit types (no \`any\` in TypeScript).
- Ensure all imports resolve correctly.`;

export function buildTscRepairPrompt(
  filePath: string,
  fileContent: string,
  errors: string[],
): string {
  return `The file "${filePath}" has TypeScript compilation errors:

${errors.map((e) => `- ${e}`).join("\n")}

Here is the current file content:
\`\`\`
${fileContent}
\`\`\`

Fix the TypeScript errors and output the complete corrected file. Output ONLY the raw source code — no markdown fences, no explanation.`;
}

export function buildTestRepairPrompt(
  implFilePath: string,
  implFileContent: string,
  testFilePath: string,
  testFileContent: string,
  failureMessages: string[],
): string {
  return `The test file "${testFilePath}" has failing tests caused by bugs in the implementation file "${implFilePath}".

Test failures:
${failureMessages.map((m) => `- ${m}`).join("\n")}

Implementation file ("${implFilePath}"):
\`\`\`
${implFileContent}
\`\`\`

Test file ("${testFilePath}") for reference (do NOT modify this — fix the implementation):
\`\`\`
${testFileContent}
\`\`\`

Fix the implementation file so the tests pass. Output ONLY the corrected implementation file — no markdown fences, no explanation.`;
}
