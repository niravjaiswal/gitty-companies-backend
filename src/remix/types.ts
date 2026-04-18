import { z } from "zod";

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

// ── Agent usage (from the Agent SDK ResultMessage) ─────────────

export type AgentUsage = {
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  turns: number;
  durationMs: number;
};

// ── Adapt metrics: records one or two agent passes ─────────────

export type AdaptPassMetrics = AgentUsage & { verified: boolean };

export type AdaptMetrics = {
  primary: AdaptPassMetrics;
  repair: AdaptPassMetrics | null;
};

// ── Validation report from the post-agent verification gate ────

export type ValidationReport = {
  tscPass: boolean;
  vitestPass: boolean;
  overallPass: boolean;
  errors: string[];
};

// ── Scenario / tasks / rubric (written by the agent into _remix_metadata.json) ──

export type RemixScenario = {
  title: string;
  company_name: string;
  narrative: string;
};

export type RemixTask = {
  title: string;
  description: string;
};

export type RemixRubricEntry = {
  criterion: string;
  weight: number;
};

// ── Remixed workspace: merged files + assessment metadata ──────

export type RemixedWorkspace = {
  files: Record<string, string>;
  scenario: RemixScenario;
  tasks: RemixTask[];
  rubric: RemixRubricEntry[];
};

// ── Orchestrator input ─────────────────────────────────────────

export type RemixOptions = {
  skeletonId: string;
  jobBrief: string;
  partCount?: number;
  examSpecifics?: string;
};

// ── Orchestrator output ────────────────────────────────────────

export type RemixResult = {
  brief: Brief;
  workspace: RemixedWorkspace;
  validation: ValidationReport;
  instructionsMd: string;
  usage: {
    extract: TokenUsage;
    adapt: AdaptMetrics;
    brief?: TokenUsage;
  };
};
