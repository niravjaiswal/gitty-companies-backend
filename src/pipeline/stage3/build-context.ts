import type { ScenarioDesign } from "../stage2/scenario-schema.js";
import type { AssessmentSpec } from "../stage1/spec-schema.js";

export interface CompressedContext {
  project_title: string;
  runtime: string;
  framework: string | null;
  narrative_oneliner: string;
  all_exports: Record<string, string[]>;
  type_definitions: string;
  /** One-line-per-file manifest summary: "path (provision): purpose" */
  manifest_summary: string;
}

export function buildCompressedContext(
  scenario: ScenarioDesign,
  spec: AssessmentSpec,
): Omit<CompressedContext, "type_definitions"> {
  const allExports: Record<string, string[]> = {};
  for (const entry of scenario.starter_repo.manifest) {
    allExports[entry.path] = entry.exports;
  }

  const narrative = scenario.scenario.narrative;
  const firstSentence = narrative.split(". ")[0];
  const narrativeOneliner = firstSentence.endsWith(".") ? firstSentence : firstSentence + ".";

  const manifestSummary = scenario.starter_repo.manifest
    .map((m) => `- ${m.path} (${m.provided_or_candidate}): ${m.purpose}`)
    .join("\n");

  return {
    project_title: scenario.scenario.title,
    runtime: spec.runtime ?? "node",
    framework: spec.framework,
    narrative_oneliner: narrativeOneliner,
    all_exports: allExports,
    manifest_summary: manifestSummary,
  };
}

export function deriveTypesList(scenario: ScenarioDesign): string {
  const typeNames = new Set<string>();

  for (const entry of scenario.starter_repo.manifest) {
    for (const exp of entry.exports) {
      if (/^[A-Z]/.test(exp) && !exp.includes("(")) {
        typeNames.add(exp);
      }
    }
  }

  const narrative = scenario.scenario.narrative;
  const technicalContext = scenario.scenario.technical_context;
  const combined = `${narrative} ${technicalContext}`;

  const lines: string[] = [];
  for (const name of typeNames) {
    lines.push(`- ${name}`);
  }

  if (lines.length === 0) {
    lines.push("- Define appropriate domain types based on the project context");
  }

  lines.push("");
  lines.push(`Context for type design: ${combined}`);

  return lines.join("\n");
}
