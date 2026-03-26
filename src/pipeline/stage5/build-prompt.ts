import type { AssessmentSpec } from "../stage1/spec-schema.js";
import type { ScenarioDesign } from "../stage2/scenario-schema.js";
import type { GenerateRepoResult } from "../stage3/generate-repo.js";
import { STAGE5_USER_PROMPT_TEMPLATE } from "./prompts.js";

export interface FinalizedManifestEntry {
  path: string;
  purpose: string;
  mode: "provided" | "candidate" | "partial" | "generated";
  exports: string[];
  dependencies: string[];
  status: "generated" | "failed_generation";
  notes: string[];
}

export interface FinalizedManifestSummary {
  files: FinalizedManifestEntry[];
  warnings: string[];
  failures: Array<{ path: string; errors: string[] }>;
}

function compareManifestEntries(a: FinalizedManifestEntry, b: FinalizedManifestEntry): number {
  return a.path.localeCompare(b.path);
}

export function buildFinalizedManifestSummary(
  scenario: ScenarioDesign,
  repo: GenerateRepoResult,
): FinalizedManifestSummary {
  const failureByPath = new Map(repo.failures.map((failure) => [failure.path, failure.errors]));

  const files: FinalizedManifestEntry[] = scenario.starter_repo.manifest.map((entry) => ({
    path: entry.path,
    purpose: entry.purpose,
    mode: entry.provided_or_candidate,
    exports: entry.exports,
    dependencies: entry.dependencies,
    status: failureByPath.has(entry.path) ? "failed_generation" : "generated",
    notes: repo.warnings.filter((warning) => warning.includes(entry.path)),
  }));

  for (const filePath of repo.files.keys()) {
    if (filePath === "README.md") {
      files.push({
        path: filePath,
        purpose: "Candidate-facing assessment overview and setup instructions",
        mode: "generated",
        exports: [],
        dependencies: [],
        status: "generated",
        notes: [],
      });
      continue;
    }

    if (!files.some((entry) => entry.path === filePath)) {
      files.push({
        path: filePath,
        purpose: "Generated support file",
        mode: "generated",
        exports: [],
        dependencies: [],
        status: failureByPath.has(filePath) ? "failed_generation" : "generated",
        notes: repo.warnings.filter((warning) => warning.includes(filePath)),
      });
    }
  }

  files.sort(compareManifestEntries);

  return {
    files,
    warnings: [...repo.warnings].sort(),
    failures: repo.failures
      .map((failure) => ({ path: failure.path, errors: failure.errors }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function buildStage5UserPrompt(
  spec: AssessmentSpec,
  scenario: ScenarioDesign,
  repo: GenerateRepoResult,
): string {
  const manifestSummary = buildFinalizedManifestSummary(scenario, repo);

  return STAGE5_USER_PROMPT_TEMPLATE
    .replaceAll("{title}", scenario.scenario.title)
    .replaceAll("{spec_json}", JSON.stringify(spec, null, 2))
    .replaceAll("{scenario_json}", JSON.stringify(scenario, null, 2))
    .replaceAll("{final_manifest_json}", JSON.stringify(manifestSummary, null, 2));
}
