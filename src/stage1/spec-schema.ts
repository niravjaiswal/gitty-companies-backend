import { z } from "zod";

export const DomainEnum = z.enum([
  "backend",
  "frontend",
  "fullstack",
  "data_engineering",
  "ml_engineering",
  "devops",
  "mobile",
  "embedded",
  "systems",
  "security",
]);

export const SkillAxisEnum = z.enum([
  "algorithmic_thinking",
  "api_design",
  "architecture",
  "async_programming",
  "caching_strategy",
  "code_organization",
  "concurrency",
  "data_modeling",
  "data_pipeline_design",
  "database_design",
  "debugging",
  "dependency_management",
  "error_handling",
  "event_driven_design",
  "graph_algorithms",
  "integration_testing",
  "logging_observability",
  "memory_management",
  "networking",
  "orm_usage",
  "pagination",
  "performance_optimization",
  "query_optimization",
  "rate_limiting",
  "real_time_processing",
  "recursion",
  "schema_design",
  "search_implementation",
  "security_practices",
  "serialization",
  "state_management",
  "stream_processing",
  "system_design",
  "testing_strategy",
  "type_safety",
  "ui_component_design",
  "validation",
]);

export const DataCharacteristicEnum = z.enum([
  "large_scale",
  "streaming",
  "time_series",
  "geospatial",
  "hierarchical",
  "graph_structured",
  "sparse",
  "high_cardinality",
  "real_time",
  "append_only",
  "immutable",
  "multi_tenant",
  "sensitive_pii",
  "unstructured",
  "relational",
  "event_sourced",
]);

export const DifficultyEnum = z.enum(["junior", "mid", "senior", "staff"]);

export const EstimatedScopeEnum = z.enum([
  "1-2 hours",
  "2-4 hours",
  "4-6 hours",
  "6-8 hours",
]);

export const AssessmentSpecSchema = z.object({
  domain: DomainEnum,
  subdomain: z.string().nullable(),
  framework: z.string().nullable(),
  runtime: z.string().nullable(),
  skill_axes: z.array(SkillAxisEnum).min(2).max(5),
  difficulty: DifficultyEnum,
  estimated_scope: EstimatedScopeEnum,
  data_characteristics: z.array(DataCharacteristicEnum).min(0).max(4),
  project_type: z.string(),
  constraints: z.array(z.string()),
  ambiguities: z.array(z.string()),
});

export type AssessmentSpec = z.infer<typeof AssessmentSpecSchema>;
