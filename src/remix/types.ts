import { z } from "zod";
import type { RemixPatch, Manifest } from "../skeletons/types.js";

// ── Brief: extracted signals from a company job posting ────────

export const BriefSchema = z.object({
  role_title: z.string().min(1),
  company_name: z.string().min(1),
  domain: z.string().min(1),
  key_skills: z.array(z.string().min(1)).min(1),
  seniority: z.string().optional(),
  tech_stack: z.array(z.string().min(1)),
  context_notes: z.string().optional(),
});

export type Brief = z.infer<typeof BriefSchema>;

// ── Token usage from a single LLM call ─────────────────────────

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  model: string;
};

// ── Agent usage (from Agent SDK) ───────────────────────────────

export type AgentUsage = {
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  turns: number;
  durationMs: number;
};

// ── Validation report from post-remix tsc + vitest ─────────────

export type ValidationReport = {
  tscPass: boolean;
  vitestPass: boolean;
  overallPass: boolean;
  repairRounds: number;
  errors: string[];
};

// ── Remixed workspace: merged files + assessment metadata ──────

export type RemixedWorkspace = {
  files: Record<string, string>;
  scenario: RemixPatch["scenario"];
  tasks: RemixPatch["tasks"];
  rubric: RemixPatch["rubric"];
};

// ── Orchestrator input ─────────────────────────────────────────

export type RemixOptions = {
  skeletonId: string;
  jobBrief: string;
  maxRepairRounds?: number;
  skipValidation?: boolean;
  useAgent?: boolean;
};

// ── Orchestrator output ────────────────────────────────────────

export type RemixResult = {
  brief: Brief;
  patch: RemixPatch | null;
  workspace: RemixedWorkspace;
  validation: ValidationReport | null;
  usage: {
    extract: TokenUsage;
    adapt: TokenUsage | AgentUsage;
  };
};
