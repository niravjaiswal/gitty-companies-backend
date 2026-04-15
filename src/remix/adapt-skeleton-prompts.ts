import type { Skeleton, Manifest } from "../skeletons/types.js";
import type { Brief } from "./types.js";

export const ADAPT_SYSTEM_PROMPT = `You are a senior software engineer customizing a coding assessment for a specific company.

You will receive a skeleton assessment (template) and a brief describing the target company and role. Your job is to produce a RemixPatch that re-themes the skeleton to match the company's domain while preserving the assessment's technical structure.

## Skeleton Contract Rules

1. **Change domain terminology, data values, and narrative — NOT architecture, control flow, or file structure.**
   - Rename domain concepts (e.g. "bookstore" → "logistics hub"), variables, types, seed data, and user-facing strings.
   - Do NOT add, remove, or restructure files. Do NOT change the overall architecture or control flow.

2. **Output full file replacements.**
   - Every patched file must contain the COMPLETE file content, not diffs or truncated snippets.
   - The "action" field must always be "replace_content".

3. **Only patch files marked adapt: true.**
   - You will be given the list of adaptable file paths. Do NOT produce patches for any other files.

4. **Preserve all import paths, exports, and type signatures exactly.**
   - File paths NEVER change during remix — import paths like './routes/tasks' must stay exactly the same.
   - Do not rename exported functions, classes, or type names.
   - You may rename local variables, string literals, data values, and user-facing text.

5. **Maintain cross-file consistency.**
   - If you rename a domain concept in one file, rename it in ALL adapt-true files that reference it.
   - Ensure types, interfaces, and function calls remain aligned across files.

6. **Keep TypeScript compilable.**
   - Do not introduce type errors, missing imports, or broken references.

7. **Test expectations must align with data changes.**
   - If you change seed data or expected values, update ALL corresponding test assertions.

8. **Rubric weights must sum to 1.0.**

9. **Never rename data-testid attributes or getByTestId selectors.**
   - data-testid values (e.g. data-testid="composer-title") are structural anchors. Copy them exactly as-is.
   - getByTestId('composer-title') in tests must remain unchanged — these are not domain-specific.
   - You MAY rename aria-label values, user-visible text, and getByText/getByLabelText selectors to match the domain.

## Output Schema

Respond with a JSON object matching this structure:

{
  "scenario": {
    "title": "string — assessment title themed to the company",
    "company_name": "string — the company name from the brief",
    "narrative": "string — 2-3 sentence scenario description for the candidate"
  },
  "file_patches": [
    {
      "path": "string — file path (must be an adapt-true file)",
      "action": "replace_content",
      "content": "string — COMPLETE replacement file content"
    }
  ],
  "tasks": [
    {
      "title": "string — task title",
      "description": "string — task description for the candidate"
    }
  ],
  "rubric": [
    {
      "criterion": "string — what is being evaluated",
      "weight": 0.25
    }
  ]
}

Respond with ONLY valid JSON. No markdown fences, no explanatory text.`;

export function buildAdaptPrompt(
  skeleton: Skeleton,
  manifest: Manifest,
  brief: Brief,
  adaptFiles: Map<string, string>,
): string {
  const parts: string[] = [];

  // 1. Brief
  parts.push("## Brief\n");
  parts.push(JSON.stringify(brief, null, 2));

  // 2. Skeleton metadata
  parts.push("\n\n## Skeleton Metadata\n");
  parts.push(
    JSON.stringify(
      {
        name: skeleton.name,
        language: skeleton.language,
        pattern: skeleton.pattern,
        description: skeleton.description,
      },
      null,
      2,
    ),
  );

  // 3. Adapt-true files table
  const adaptEntries = manifest.files.filter((f) => f.adapt);
  parts.push("\n\n## Adaptable Files\n");
  parts.push("| Path | Role | Purpose |");
  parts.push("| --- | --- | --- |");
  for (const entry of adaptEntries) {
    parts.push(`| ${entry.path} | ${entry.role} | ${entry.purpose} |`);
  }

  // 4. File contents
  parts.push("\n\n## File Contents\n");
  for (const [path, content] of adaptFiles) {
    parts.push(`\`\`\`typescript\n// path: ${path}\n${content}\n\`\`\`\n`);
  }

  // 5. Final directive
  parts.push(
    "Produce a RemixPatch JSON object that customizes this skeleton for the company described in the brief.",
  );

  return parts.join("\n");
}
