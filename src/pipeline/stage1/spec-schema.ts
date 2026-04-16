import { z } from "zod";
import {
  DomainEnum,
  SkillAxisEnum,
  DifficultyEnum,
  EstimatedScopeEnum,
} from "../../skeletons/enums.js";

export { DomainEnum, SkillAxisEnum, DifficultyEnum, EstimatedScopeEnum };

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
