import type { AssessmentSpec } from "../../src/stage1/spec-schema.js";

export interface Stage2TestFixture {
  name: string;
  input: AssessmentSpec;
}

export const fixtures: Stage2TestFixture[] = [
  {
    name: "Backend assessment — Fastify/Node",
    input: {
      domain: "backend",
      subdomain: "api development",
      framework: "fastify",
      runtime: "node",
      skill_axes: ["api_design", "error_handling", "database_design"],
      difficulty: "senior",
      estimated_scope: "4-6 hours",
      data_characteristics: ["relational", "multi_tenant"],
      project_type: "REST API service",
      constraints: [],
      ambiguities: [],
    },
  },
  {
    name: "Frontend assessment — React/TypeScript",
    input: {
      domain: "frontend",
      subdomain: "web applications",
      framework: "react",
      runtime: "node",
      skill_axes: ["ui_component_design", "state_management", "type_safety"],
      difficulty: "mid",
      estimated_scope: "2-4 hours",
      data_characteristics: [],
      project_type: "interactive dashboard",
      constraints: ["Must use TypeScript"],
      ambiguities: [],
    },
  },
  {
    name: "Data engineering — Python streaming",
    input: {
      domain: "data_engineering",
      subdomain: "streaming pipelines",
      framework: null,
      runtime: "python",
      skill_axes: [
        "stream_processing",
        "data_pipeline_design",
        "error_handling",
      ],
      difficulty: "senior",
      estimated_scope: "4-6 hours",
      data_characteristics: ["streaming", "large_scale", "time_series"],
      project_type: "data pipeline",
      constraints: [],
      ambiguities: [],
    },
  },
  {
    name: "Vague/minimal spec — graceful handling",
    input: {
      domain: "backend",
      subdomain: null,
      framework: null,
      runtime: null,
      skill_axes: ["api_design", "testing_strategy"],
      difficulty: "mid",
      estimated_scope: "2-4 hours",
      data_characteristics: [],
      project_type: "web service",
      constraints: [],
      ambiguities: [
        "No framework specified",
        "No specific requirements given",
      ],
    },
  },
  {
    name: "Heavily constrained spec — many requirements",
    input: {
      domain: "backend",
      subdomain: "microservices",
      framework: "express",
      runtime: "node",
      skill_axes: [
        "api_design",
        "caching_strategy",
        "rate_limiting",
        "security_practices",
        "logging_observability",
      ],
      difficulty: "staff",
      estimated_scope: "6-8 hours",
      data_characteristics: ["multi_tenant", "high_cardinality", "real_time"],
      project_type: "distributed service",
      constraints: [
        "Must use Redis for caching",
        "Must implement JWT authentication",
        "Must include rate limiting per tenant",
        "Must have structured logging with correlation IDs",
        "Must handle graceful shutdown",
      ],
      ambiguities: [],
    },
  },
];
