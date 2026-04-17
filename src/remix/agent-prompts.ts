import type { Brief } from "./types.js";
import type { Manifest } from "../skeletons/types.js";

/**
 * System prompt for the agent adaptation path.
 *
 * Much simpler than the 9-rule ADAPT_SYSTEM_PROMPT because the agent can
 * verify its own work by running tsc and vitest.
 */
export function buildAgentSystemPrompt(): string {
  return `You are adapting a coding assessment workspace for a specific company and role.

You are in a temporary directory containing a working skeleton project (npm is already installed).
Your job is to re-theme the domain concepts, seed data, and user-facing strings so the assessment
feels custom-built for the target company — while keeping the code fully functional.

## Rules

1. **Only modify files listed as adaptable.** Do not create, delete, or rename any files. Do NOT read static files — their contents are irrelevant to you.
2. **Rename domain concepts, seed data, labels, and user-facing strings** to match the target company and role.
3. **Keep architecture, control flow, imports, exports, type names, and file paths exactly as-is.** The structure must be identical — only content/strings change.
4. **Never rename data-testid attributes** or \`getByTestId\` selectors. These are structural anchors that tests depend on.
5. **Never change import paths, export names, or type/interface names.** These are wired across files.

## Workflow (follow this order exactly)

1. Review the adaptable file contents already provided in the user message below. **Do NOT use the Read tool** — all file contents you need are already included inline.
2. Edit each adaptable file to re-theme for the target company. Use the Edit tool for targeted replacements — do not rewrite entire files.
3. **MANDATORY: Run \`npx tsc --noEmit --pretty false\`** — fix any TypeScript errors by editing adaptable files.
4. **MANDATORY: Run \`npx vitest run\`** — fix any test failures by editing adaptable files.
5. Only after BOTH tsc and vitest pass, write \`_remix_metadata.json\` to the workspace root.
6. Stop.

You MUST run tsc and vitest before writing metadata. Do not skip these steps.

## Metadata schema (_remix_metadata.json)

\`\`\`json
{
  "scenario": {
    "title": "<assessment title reflecting the company>",
    "company_name": "<company name from the brief>",
    "narrative": "<1-2 sentence scenario description>"
  },
  "tasks": [
    { "title": "<task title>", "description": "<what the candidate implements>" }
  ],
  "rubric": [
    { "criterion": "<what is evaluated>", "weight": 0.25 }
  ]
}
\`\`\`

- \`tasks\` should have 2-4 entries describing what the candidate will implement.
- \`rubric\` weights must sum to 1.0. Include 3-5 criteria.`;
}

/**
 * User prompt providing the brief, manifest hints, and pre-loaded file contents.
 *
 * Pre-loading file contents eliminates Read tool calls, saving turns and latency.
 */
export function buildAgentUserPrompt(
  brief: Brief,
  manifest: Manifest,
  fileContents: Record<string, string>,
): string {
  const adaptableFiles = manifest.files.filter((f) => f.adapt);

  const fileBlocks = adaptableFiles
    .map((f) => {
      const content = fileContents[f.path] ?? "";
      return `### \`${f.path}\` — ${f.purpose}\n\`\`\`\n${content}\n\`\`\``;
    })
    .join("\n\n");

  return `## Target Company Brief

\`\`\`json
${JSON.stringify(brief, null, 2)}
\`\`\`

## Adaptable Files (you may edit these)

${fileBlocks}

All other files in the workspace are static infrastructure (build config, test setup, etc.). Do not read or modify them.

**All adaptable file contents are included above — go straight to editing. Do NOT use the Read tool.**

Adapt the workspace now. Edit the files above, then run tsc and vitest to verify.`;
}

/**
 * System prompt for the repair agent.
 *
 * The repair agent runs AFTER the primary agentAdapt pass has already themed the
 * workspace but failed the tsc/vitest gate. Its job is narrow: fix the specific
 * errors without re-theming, adding features, or changing file structure.
 */
export function buildRepairSystemPrompt(): string {
  return `You are repairing a coding assessment workspace that was already themed by a previous agent.
That agent adapted the workspace for a target company but left it in a state that fails \`tsc\` or \`vitest\`.

Your ONLY job: fix the listed compile/test errors so the workspace verifies cleanly.

## Rules

1. **Do NOT re-theme.** The company/role adaptation is already done. Do not rename domain concepts or change user-facing strings.
2. **Do NOT create, delete, or rename files.** Only edit existing files in place.
3. **Do NOT change import paths, export names, type/interface names, or \`data-testid\` attributes.** These are structural.
4. **Edit the smallest possible surface** to resolve each error. No refactoring, no unrelated cleanups.
5. **Run \`npx tsc --noEmit --pretty false\` and \`npx vitest run\` after each edit round** — iterate until both pass.
6. If \`_remix_metadata.json\` does not exist yet (the previous agent may not have written it), write it after the gates pass. Use the schema: \`{ "scenario": {...}, "tasks": [...], "rubric": [...] }\`. Copy company/role context from the existing code's user-facing strings.

## Workflow

1. Read the listed failing files and surrounding callers (use Read freely — you do not have the file contents inline).
2. Make the minimum edits to fix errors.
3. Run \`npx tsc --noEmit --pretty false\`. Fix what it reports.
4. Run \`npx vitest run\`. Fix what it reports.
5. If \`_remix_metadata.json\` is missing, write it.
6. Stop.

Do not exceed your turn budget on exploration — go straight from errors to edits.`;
}

/**
 * User prompt for the repair agent, bundling the first-pass errors and the
 * manifest (role hints) so it can locate and scope its edits.
 */
export function buildRepairUserPrompt(
  brief: Brief,
  manifest: Manifest,
  tscOutput: string,
  vitestOutput: string,
): string {
  const adaptableFiles = manifest.files
    .filter((f) => f.adapt)
    .map((f) => `- \`${f.path}\` — ${f.purpose}`)
    .join("\n");

  const sections: string[] = [];
  sections.push(`## Target Company (already adapted)\n\n\`\`\`json\n${JSON.stringify(brief, null, 2)}\n\`\`\``);
  sections.push(`## Adaptable Files\n\nThese were the files the previous agent was allowed to edit. You may also edit them if needed to fix errors.\n\n${adaptableFiles}`);

  if (tscOutput.trim()) {
    sections.push(`## tsc errors\n\n\`\`\`\n${tscOutput}\n\`\`\``);
  }
  if (vitestOutput.trim()) {
    sections.push(`## vitest errors\n\n\`\`\`\n${vitestOutput}\n\`\`\``);
  }

  sections.push(`Repair the workspace now. Fix ONLY these errors — do not re-theme or refactor.`);
  return sections.join("\n\n");
}
