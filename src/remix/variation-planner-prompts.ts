import type { Skeleton, VariationAxis } from "../skeletons/types.js";
import type { Brief } from "./types.js";

export function buildPlannerSystemPrompt(): string {
  return `You are designing a coding assessment by selecting policy choices ("variation axes") that bend a reusable skeleton task toward a specific company and role.

You will receive:
- A target company brief (role, seniority, domain, key skills)
- A skeleton task description and its declared variation axes
- The default value for each axis

For each axis, decide whether to keep the default or pick a different value. Your goal:

1. **Match seniority.** Junior briefs deserve safer defaults (less ambiguity, fewer judgment calls). Mid briefs invite one clear judgment call. Senior briefs may flex multiple axes and pick the more demanding option.
2. **Match domain.** A FinTech compliance role should pull policies that emphasize correctness/auditability over UX polish. A consumer-app role should pull policies that emphasize UI responsiveness. A platform/devtools role should pull policies that emphasize composability.
3. **Match skill emphasis.** Brief key_skills should bias which axes you flex. If the brief emphasizes testing, flex axes tagged with skill_axis: testing_strategy. If it emphasizes API design, flex axes tagged with api_design. Skip axes that don't connect to the brief's emphasis.
4. **Flex 1-3 axes per remix.** Do not flex everything. Each non-default choice means the executor must restructure tests and fixtures — keep the surface contained.
5. **Mark axes as not_applicable** when no axis value better serves the brief than the default. Better to ship coherent defaults than a tortured fit.

Output strict JSON with this exact shape (no code fences, no commentary):

\`\`\`json
{
  "selections": [
    {
      "axis_id": "<id from variation_axes>",
      "value": "<one of the values for enum; integer in [min,max] for range; true|false for bool>",
      "rationale": "<one sentence tying this choice to the brief>"
    }
  ],
  "not_applicable": ["<axis_id>", "..."],
  "overall_rationale": "<2-3 sentences describing the assessment's overall flavor for this brief>"
}
\`\`\`

Rules:
- Include every axis exactly once — in selections (with a chosen value) or in not_applicable.
- For an enum axis, value MUST be one of the declared values (case-sensitive).
- For a range axis, value MUST be an integer in [min, max].
- For a bool axis, value MUST be true or false.
- If an axis is in not_applicable, the default is implicitly used; do not include it in selections.
- Pick at most 3 non-default selections.`;
}

export function buildPlannerUserPrompt(
  brief: Brief,
  skeleton: Skeleton,
  axes: VariationAxis[],
): string {
  const axesRendered = axes
    .map((a) => {
      const common = `- **${a.id}** (${a.kind}${a.skill_axis ? `, skill_axis: ${a.skill_axis}` : ""})\n  description: ${a.description}\n  default: ${JSON.stringify(a.default)}`;
      if (a.kind === "enum") {
        return `${common}\n  values: ${JSON.stringify(a.values)}`;
      }
      if (a.kind === "range") {
        return `${common}\n  range: [${a.min}, ${a.max}]`;
      }
      return common;
    })
    .join("\n\n");

  return `## Brief

\`\`\`json
${JSON.stringify(brief, null, 2)}
\`\`\`

## Skeleton

name: ${skeleton.name}
pattern: ${skeleton.pattern}
difficulty range: ${skeleton.difficulty_range.min} → ${skeleton.difficulty_range.max}
skill axes: ${skeleton.skill_axes.join(", ")}
description: ${skeleton.description}

## Variation axes

${axesRendered}

Pick values now. Output JSON only.`;
}
