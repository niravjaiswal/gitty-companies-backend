import { z } from "zod";
import {
  DomainEnum,
  SkillAxisEnum,
  DifficultyEnum,
  EstimatedScopeEnum,
} from "./enums.js";

// ── Language & pattern enums ────────────────────────────────────

export const SkeletonLanguageEnum = z.enum(["typescript", "python"]);

export const SkeletonPatternEnum = z.enum([
  "react-spa",
  "rest-api",
  "cli-tool",
  "data-processing",
  "full-stack",
  "real-time",
]);

// ── File role in the manifest ───────────────────────────────────

export const FileRoleEnum = z.enum(["provided", "candidate", "partial"]);

// ── Manifest file entry ─────────────────────────────────────────
//
// Each file in a skeleton has:
//   role      — what the candidate sees (provided code, candidate-authored, or partial)
//   adapt     — whether the AI remix layer should modify this file
//   purpose   — human-readable description of the file's role
//
// Static files (adapt: false) are never sent to the LLM and apply-patch
// rejects any patches targeting them. This constrains the LLM's error surface.

export const ManifestFileEntrySchema = z.object({
  path: z.string().min(1),
  role: FileRoleEnum,
  adapt: z.boolean(),
  purpose: z.string().min(1),
});

export const ManifestSchema = z.object({
  files: z.array(ManifestFileEntrySchema).min(1),
});

// ── Variation axes (declare what the planner may flex per brief) ─

const VariationAxisCommon = z.object({
  id: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/, "axis id must be snake_case"),
  description: z.string().min(1),
  skill_axis: SkillAxisEnum.optional(),
});

export const EnumVariationAxisSchema = VariationAxisCommon.extend({
  kind: z.literal("enum"),
  values: z.array(z.string().min(1)).min(2),
  default: z.string().min(1),
}).refine((a) => a.values.includes(a.default), {
  message: "default must be one of values",
  path: ["default"],
});

export const RangeVariationAxisSchema = VariationAxisCommon.extend({
  kind: z.literal("range"),
  min: z.number().int(),
  max: z.number().int(),
  default: z.number().int(),
}).refine((a) => a.min <= a.default && a.default <= a.max, {
  message: "default must be within [min, max]",
  path: ["default"],
});

export const BoolVariationAxisSchema = VariationAxisCommon.extend({
  kind: z.literal("bool"),
  default: z.boolean(),
});

export const VariationAxisSchema = z.discriminatedUnion("kind", [
  EnumVariationAxisSchema,
  RangeVariationAxisSchema,
  BoolVariationAxisSchema,
]);

// ── Skeleton metadata (skeleton.json) ───────────────────────────

export const AssessmentCopySchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  instructions_md: z.string().min(1),
});

export const SkeletonSchema = z.object({
  name: z.string().min(1),
  language: SkeletonLanguageEnum,
  pattern: SkeletonPatternEnum,
  difficulty_range: z.object({
    min: DifficultyEnum,
    max: DifficultyEnum,
  }),
  skill_axes: z.array(SkillAxisEnum).min(1).max(8),
  estimated_scope: z.object({
    min: EstimatedScopeEnum,
    max: EstimatedScopeEnum,
  }),
  domain_tags: z.array(DomainEnum).min(1),
  description: z.string().min(1),
  assessment_copy: AssessmentCopySchema.optional(),
  variation_axes: z.array(VariationAxisSchema).optional(),
});

// ── Inferred types ──────────────────────────────────────────────

export type SkeletonLanguage = z.infer<typeof SkeletonLanguageEnum>;
export type SkeletonPattern = z.infer<typeof SkeletonPatternEnum>;
export type FileRole = z.infer<typeof FileRoleEnum>;
export type ManifestFileEntry = z.infer<typeof ManifestFileEntrySchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type AssessmentCopy = z.infer<typeof AssessmentCopySchema>;
export type EnumVariationAxis = z.infer<typeof EnumVariationAxisSchema>;
export type RangeVariationAxis = z.infer<typeof RangeVariationAxisSchema>;
export type BoolVariationAxis = z.infer<typeof BoolVariationAxisSchema>;
export type VariationAxis = z.infer<typeof VariationAxisSchema>;
export type VariationValue = string | number | boolean;
export type Skeleton = z.infer<typeof SkeletonSchema>;

export type LoadedSkeleton = {
  skeleton: Skeleton;
  manifest: Manifest;
  files: Record<string, string>;
};
