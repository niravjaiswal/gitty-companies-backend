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

export const DifficultyEnum = z.enum(["junior", "mid", "senior", "staff"]);

export const EstimatedScopeEnum = z.enum([
  "1-2 hours",
  "2-4 hours",
  "4-6 hours",
  "6-8 hours",
]);
