import type { Brief } from "./types.js";
import type { Manifest, VariationAxis } from "../skeletons/types.js";
import type { VariationPlan } from "./variation-planner.js";

export function buildVarySystemPrompt(): string {
  return `You are extending a coding assessment workspace by applying chosen policy variations on top of an already-themed skeleton.

The workspace is already themed for the target company — names, fixtures, README copy, etc. were updated by a prior agent. Your job is to bend the **substance** of the task to match a specific variation plan.

## What "applying a variation" means

Each variation axis has a chosen value. That value names a policy. You must:

1. Modify the **candidate-side code** so the chosen policy is the one the candidate is expected to implement.
2. Update the **tests** so they enforce the chosen policy (this is the new contract).
3. Update the **fixtures** if the policy requires new edge cases.
4. Update the **README** task section so the spec the candidate reads matches the policy the tests enforce.

The default value for an axis means "no change from baseline" — only flex axes whose chosen value differs from default.

## Sacred (do not change)

- File paths and folder structure
- Import paths and export names
- TypeScript type/interface names
- \`data-testid\` attributes and \`getByTestId\` selectors
- Top-level component/function signatures the tests already import
- \`package.json\`, \`vite.config.*\`, \`tsconfig.json\`, \`vitest.config.*\`, \`tsconfig.*\`

## Allowed

- Edit any \`adapt: true\` file in the manifest, including test files.
- Add new fixture rows or edge cases inside existing files.
- Tighten or replace test assertions to bind the chosen policy.
- Rewrite the README task description so it matches the policy.

## Workflow

1. Read the variation plan in the user message. For each non-default selection, note exactly what behavior the chosen value implies.
2. Plan the smallest set of file edits that makes the new policy the one the tests enforce AND the candidate is asked to implement.
3. Make edits with Edit tool calls. Do not use Read on files whose contents are already provided inline.
4. **MANDATORY: Run \`npx tsc --noEmit --pretty false\`** — fix any TypeScript errors.
5. **MANDATORY: Run \`npx vitest run\`** — fix any test failures. If tests are now over- or under-specified for the policy, adjust the **tests**, not just the code, until both the spec and the tests match.
6. When both gates pass, write \`_remix_vary_metadata.json\` with the applied variation set. Schema:

\`\`\`json
{
  "applied": [
    { "axis_id": "<id>", "value": "<value>", "summary": "<one sentence>" }
  ],
  "test_coverage_notes": "<one sentence on what the new/modified tests enforce>"
}
\`\`\`

7. Stop.

## Quality bar

- Do NOT introduce hardcoded values that map directly to test fixtures (e.g. if a test expects [1,2,3], do not literally return [1,2,3] from the candidate-facing function).
- Tests must check observable behavior under the new policy, not just exercise it.
- If applying a variation requires removing an existing test, replace it with a test that enforces the new policy — never just delete tests.
- Keep the candidate file (\`role: "candidate"\`) implementing the chosen policy as a working reference. The variation is a re-specification, not a regression.`;
}

export function buildVaryUserPrompt(args: {
  brief: Brief;
  manifest: Manifest;
  plan: VariationPlan;
  axes: VariationAxis[];
  fileContents: Record<string, string>;
}): string {
  const { brief, manifest, plan, axes, fileContents } = args;
  const axesById = new Map(axes.map((a) => [a.id, a]));

  const nonDefault = plan.selections.filter((s) => !s.isDefault);
  const defaultsKept = [
    ...plan.selections.filter((s) => s.isDefault).map((s) => s.axisId),
    ...plan.notApplicable,
  ];

  const variationBlock = nonDefault
    .map((s) => {
      const axis = axesById.get(s.axisId);
      const valueLine = `chosen value: ${JSON.stringify(s.value)}`;
      const defaultLine = axis ? `default value: ${JSON.stringify(axis.default)}` : "";
      const descLine = axis ? `axis description: ${axis.description}` : "";
      return [`### ${s.axisId}`, valueLine, defaultLine, descLine, `rationale: ${s.rationale}`]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const editableEntries = manifest.files.filter((f) => f.adapt);
  const editableList = editableEntries
    .map((f) => `- \`${f.path}\` — ${f.purpose} (role: ${f.role})`)
    .join("\n");

  const inlineFiles = editableEntries
    .map((f) => {
      const content = fileContents[f.path] ?? "";
      return `### \`${f.path}\`\n\`\`\`\n${content}\n\`\`\``;
    })
    .join("\n\n");

  const sections: string[] = [];
  sections.push(`## Target Company Brief\n\n\`\`\`json\n${JSON.stringify(brief, null, 2)}\n\`\`\``);
  sections.push(`## Overall variation rationale\n\n${plan.overallRationale}`);

  if (nonDefault.length > 0) {
    sections.push(`## Variations to apply (${nonDefault.length} non-default)\n\n${variationBlock}`);
  } else {
    sections.push(`## Variations to apply\n\n_All axes kept default — only verify that tsc and vitest pass, then write \`_remix_vary_metadata.json\` with an empty \`applied\` array._`);
  }

  if (defaultsKept.length > 0) {
    sections.push(`## Axes kept at default (no action required)\n\n${defaultsKept.map((id) => `- ${id}`).join("\n")}`);
  }

  sections.push(`## Editable files\n\n${editableList}`);
  sections.push(`## Current file contents (do NOT use Read tool — contents are inline)\n\n${inlineFiles}`);
  sections.push(`Apply the variations now. Run tsc and vitest after edits. Write \`_remix_vary_metadata.json\` when both pass.`);

  return sections.join("\n\n");
}
