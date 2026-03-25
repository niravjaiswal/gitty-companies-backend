import { z } from "zod";

export const FileProvisionEnum = z.enum(["provided", "candidate", "partial"]);

export const SeedDataFormatEnum = z.enum(["json", "csv", "sql", "generated"]);

export const ManifestFileSchema = z.object({
  path: z.string(),
  purpose: z.string(),
  provided_or_candidate: FileProvisionEnum,
  dependencies: z.array(z.string()),
  exports: z.array(z.string()),
});

export const ConfigFileSchema = z.object({
  path: z.string(),
  purpose: z.string(),
});

export const SeedDataSchema = z.object({
  description: z.string(),
  format: SeedDataFormatEnum,
  characteristics: z.array(z.string()),
});

export const CandidateTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  target_files: z.array(z.string()),
  tests_for: z.array(z.string()),
  acceptance_criteria: z.array(z.string()),
  hints: z.array(z.string()),
  estimated_minutes: z.number(),
  order: z.number(),
});

export const ScoringSchema = z.object({
  excellent: z.string(),
  acceptable: z.string(),
  poor: z.string(),
});

export const RubricCriterionSchema = z.object({
  criterion: z.string(),
  skill_axis: z.string(),
  weight: z.number(),
  scoring: ScoringSchema,
  automated_testable: z.boolean(),
  test_description: z.string().nullable(),
});

export const ScenarioDesignSchema = z.object({
  scenario: z.object({
    title: z.string(),
    narrative: z.string(),
    company_context: z.string(),
    technical_context: z.string(),
  }),
  starter_repo: z.object({
    manifest: z.array(ManifestFileSchema),
    config_files: z.array(ConfigFileSchema),
    seed_data: SeedDataSchema.nullable(),
  }),
  candidate_tasks: z.array(CandidateTaskSchema),
  evaluation_rubric: z.array(RubricCriterionSchema),
  readme_structure: z.object({
    overview: z.string(),
    setup_steps: z.array(z.string()),
    task_descriptions: z.array(z.string()),
    submission_instructions: z.string(),
    time_expectation: z.string(),
  }),
});

export type ScenarioDesign = z.infer<typeof ScenarioDesignSchema>;
