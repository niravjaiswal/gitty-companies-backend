import { describe, expect, it } from "vitest";
import { validatePrdMarkdown } from "../validate-prd.js";

describe("validatePrdMarkdown", () => {
  it("accepts a PRD with the required structure", () => {
    const markdown = `# PRD: Fluxharbor Intake Service
## Assessment Summary
- Senior backend assessment

## Scenario Narrative
Fluxharbor is extending a partner event intake workflow.

## Candidate Deliverables
- Implement validation logic in the intake service.

## Functional Requirements
- Reject malformed timestamps.

## Technical Constraints
- Use the existing Fastify service structure.

## Starter Repository
- \`src/routes/intake.ts\` contains route scaffolding.

## Candidate Tasks
1. Implement validation.

## Evaluation Rubric
- 40% automated validation coverage.

## Submission Notes
- Reviewer should expect passing tests and clear error handling.`;

    expect(validatePrdMarkdown(markdown, "Fluxharbor Intake Service")).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("rejects missing headings and code fences", () => {
    const markdown = `# PRD: Fluxharbor Intake Service
## Assessment Summary
\`\`\`md
bad
\`\`\`
`;

    const result = validatePrdMarkdown(markdown, "Fluxharbor Intake Service");

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "PRD must not contain markdown code fences",
        "Missing required heading: ## Scenario Narrative",
      ]),
    );
  });
});
