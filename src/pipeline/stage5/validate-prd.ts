export const REQUIRED_PRD_HEADINGS = [
  "## Assessment Summary",
  "## Scenario Narrative",
  "## Candidate Deliverables",
  "## Functional Requirements",
  "## Technical Constraints",
  "## Starter Repository",
  "## Candidate Tasks",
  "## Evaluation Rubric",
  "## Submission Notes",
] as const;

export interface PrdValidationResult {
  valid: boolean;
  errors: string[];
}

function getSectionBody(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start === -1) return "";

  const sectionStart = start + heading.length;
  const remainder = markdown.slice(sectionStart);
  const nextHeadingOffset = remainder.search(/\n##\s/);
  const section = nextHeadingOffset === -1
    ? remainder
    : remainder.slice(0, nextHeadingOffset);

  return section.trim();
}

export function validatePrdMarkdown(markdown: string, expectedTitle: string): PrdValidationResult {
  const errors: string[] = [];
  const normalized = markdown.trim();

  if (!normalized.startsWith(`# PRD: ${expectedTitle}`)) {
    errors.push(`PRD must start with "# PRD: ${expectedTitle}"`);
  }

  for (const heading of REQUIRED_PRD_HEADINGS) {
    if (!normalized.includes(heading)) {
      errors.push(`Missing required heading: ${heading}`);
      continue;
    }

    const body = getSectionBody(normalized, heading);
    if (!body) {
      errors.push(`Section is empty: ${heading}`);
    }
  }

  const codeFenceCount = (normalized.match(/```/g) ?? []).length;
  if (codeFenceCount > 0) {
    errors.push("PRD must not contain markdown code fences");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
