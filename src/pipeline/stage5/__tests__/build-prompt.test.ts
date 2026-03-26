import { describe, expect, it } from "vitest";
import type { AssessmentSpec } from "../../stage1/spec-schema.js";
import type { ScenarioDesign } from "../../stage2/scenario-schema.js";
import type { GenerateRepoResult } from "../../stage3/generate-repo.js";
import {
  buildFinalizedManifestSummary,
  buildStage5UserPrompt,
} from "../build-prompt.js";

const spec: AssessmentSpec = {
  domain: "backend",
  subdomain: "event ingestion",
  framework: "fastify",
  runtime: "node",
  skill_axes: ["api_design", "error_handling", "testing_strategy"],
  difficulty: "senior",
  estimated_scope: "4-6 hours",
  data_characteristics: ["real_time", "relational"],
  project_type: "ingestion service",
  constraints: ["Must persist invalid payload errors for later review"],
  ambiguities: [],
};

const scenario: ScenarioDesign = {
  scenario: {
    title: "Fluxharbor Intake Service",
    narrative: "Fluxharbor is rolling out a partner event intake service.",
    company_context: "The platform team owns shared ingestion services for logistics partners.",
    technical_context: "A Fastify service already boots locally and exposes health endpoints.",
  },
  starter_repo: {
    manifest: [
      {
        path: "src/routes/intake.ts",
        purpose: "Defines the partner intake endpoint",
        provided_or_candidate: "partial",
        dependencies: ["src/services/intake-service.ts", "src/types.ts"],
        exports: ["registerIntakeRoutes"],
      },
      {
        path: "src/services/intake-service.ts",
        purpose: "Normalizes and validates incoming events",
        provided_or_candidate: "candidate",
        dependencies: ["src/types.ts"],
        exports: ["IntakeService", "NormalizedEvent"],
      },
    ],
    config_files: [
      {
        path: "package.json",
        purpose: "Defines scripts and dependencies",
      },
    ],
    seed_data: {
      description: "Sample partner payloads with malformed timestamps and duplicate ids",
      format: "json",
      characteristics: ["Small but intentionally dirty", "Includes retry edge cases"],
    },
  },
  candidate_tasks: [
    {
      id: "task-1",
      title: "Implement intake validation",
      description: "Validate partner payloads and reject malformed events.",
      target_files: ["src/services/intake-service.ts"],
      tests_for: ["Rejects malformed timestamps", "Preserves partner ids"],
      acceptance_criteria: [
        "Malformed timestamps are rejected with explicit errors",
        "Duplicate event ids are handled deterministically",
      ],
      hints: [],
      estimated_minutes: 80,
      order: 1,
    },
  ],
  evaluation_rubric: [
    {
      criterion: "Input validation and error handling",
      skill_axis: "error_handling",
      weight: 40,
      scoring: {
        excellent: "Rejects malformed inputs with precise reasons and no silent drops",
        acceptable: "Rejects obvious malformed inputs",
        poor: "Accepts invalid data or hides failures",
      },
      automated_testable: true,
      test_description: "Validation tests cover malformed payloads and duplicate ids",
    },
    {
      criterion: "Route and service design",
      skill_axis: "api_design",
      weight: 35,
      scoring: {
        excellent: "Separates transport and domain logic cleanly",
        acceptable: "Works but mixes some concerns",
        poor: "Endpoint logic is tangled and hard to extend",
      },
      automated_testable: false,
      test_description: null,
    },
    {
      criterion: "Test quality",
      skill_axis: "testing_strategy",
      weight: 25,
      scoring: {
        excellent: "Adds focused tests for success and failure paths",
        acceptable: "Adds baseline coverage",
        poor: "Leaves important behaviors untested",
      },
      automated_testable: true,
      test_description: "New tests cover core validation branches",
    },
  ],
  readme_structure: {
    overview: "Build the missing event intake behavior.",
    setup_steps: ["Install dependencies", "Run the test suite"],
    task_descriptions: ["Complete validation in the intake service"],
    submission_instructions: "Submit the finished repository.",
    time_expectation: "Expect roughly 4 hours.",
  },
};

const repo: GenerateRepoResult = {
  files: new Map([
    ["src/routes/intake.ts", "// partial route scaffold"],
    ["src/services/intake-service.ts", "// candidate skeleton"],
    ["README.md", "# Fluxharbor Intake Service"],
  ]),
  warnings: ["src/services/intake-service.ts: repaired after initial validation failure"],
  failures: [],
};

describe("buildFinalizedManifestSummary", () => {
  it("summarizes manifest files and generated support files", () => {
    const summary = buildFinalizedManifestSummary(scenario, repo);

    expect(summary.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/routes/intake.ts",
          mode: "partial",
          status: "generated",
        }),
        expect.objectContaining({
          path: "src/services/intake-service.ts",
          mode: "candidate",
          notes: ["src/services/intake-service.ts: repaired after initial validation failure"],
        }),
        expect.objectContaining({
          path: "README.md",
          mode: "generated",
        }),
      ]),
    );
  });
});

describe("buildStage5UserPrompt", () => {
  it("includes the required heading contract and serialized inputs", () => {
    const prompt = buildStage5UserPrompt(spec, scenario, repo);

    expect(prompt).toContain("# PRD: Fluxharbor Intake Service");
    expect(prompt).toContain("## Starter Repository");
    expect(prompt).toContain("\"title\": \"Fluxharbor Intake Service\"");
    expect(prompt).toContain("\"path\": \"src/services/intake-service.ts\"");
    expect(prompt).toContain("\"mode\": \"candidate\"");
    expect(prompt).toContain("\"warnings\": [");
  });
});
