import type { Brief, RemixScenario, RemixTask, RemixRubricEntry } from "./types.js";
import type { AssessmentCopy } from "../skeletons/types.js";

export const GENERATE_BRIEF_SYSTEM_PROMPT = `You are a technical hiring-content writer. You write candidate-facing assessment briefs in Markdown, following a strict section structure.

## Output contract

- Emit ONLY Markdown. No preamble, no explanation, no code fence wrapping the document.
- Start the document with a single \`# <Title>\` line.
- Then emit these sections in this exact order, each as a \`## \` heading:
  1. \`## Overview\` — 2–4 sentences framing the scenario, company, and stack.
  2. \`## Company codebase\` — 2–3 sentences describing what's already in the repo (files, framework, what works today).
  3. \`## Part A\` through \`## Part <N-th letter>\` — exactly one per part. The caller supplies N.
- Use blank lines between sections.
- Never reorder sections. Never introduce extra top-level \`##\` sections. Never use \`### Part A\` — it must be \`## Part A\`.

## Part convention

- Part A = must-ship core. What a credible candidate should finish.
- Part B = follow-up scope. Natural extension after A.
- Part C = stretch scope. Visible ambition if they get there.
- Part D onward = bonus polish items, one focused target per part.

Each part has:
- One framing sentence.
- 3–6 concrete bullets that reference actual files, functions, or behaviors from the scenario/tasks you are given.

Do not invent capabilities the workspace doesn't have. If the recruiter's "exam specifics" conflict with the skeleton, the recruiter wins.`;

export interface GenerateBriefPromptInput {
  brief: Brief;
  assessmentCopy?: AssessmentCopy;
  examSpecifics?: string;
  scenario: RemixScenario;
  tasks: RemixTask[];
  rubric: RemixRubricEntry[];
  partCount: number;
}

export function letterForIndex(index: number): string {
  return String.fromCharCode(65 + index);
}

export function buildGenerateBriefPrompt(input: GenerateBriefPromptInput): string {
  const { brief, assessmentCopy, examSpecifics, scenario, tasks, rubric, partCount } = input;

  const lastLetter = letterForIndex(Math.max(0, partCount - 1));
  const partsLine =
    partCount === 1
      ? `Emit exactly 1 Part section: \`## Part A\`.`
      : `Emit exactly ${partCount} Part sections: \`## Part A\` through \`## Part ${lastLetter}\`.`;

  const taskLines = tasks.length
    ? tasks.map((t) => `- ${t.title}: ${t.description}`).join("\n")
    : "(no tasks captured)";

  const rubricLines = rubric.length
    ? rubric.map((r) => `- ${r.criterion} (weight ${r.weight})`).join("\n")
    : "(no rubric captured)";

  const skeletonCopy = assessmentCopy?.instructions_md?.trim() || "(no skeleton copy)";

  const specifics = examSpecifics?.trim() || "(none provided)";

  return `Recruiter brief signals:
${JSON.stringify(brief, null, 2)}

Skeleton canned copy (context only — do NOT copy verbatim, but you may reference file names or commands it mentions):
${skeletonCopy}

Recruiter exam specifics (HARD REQUIREMENTS — these override the skeleton's defaults):
${specifics}

Agent-generated workspace facts (the brief must match these, do not invent):
Scenario title: ${scenario.title}
Scenario narrative: ${scenario.narrative}

Tasks:
${taskLines}

Rubric:
${rubricLines}

${partsLine}

Document title line should be something like \`# ${scenario.title}\` or \`# ${scenario.title} — ${brief.company_name}\`. Generate the candidate brief now.`;
}
