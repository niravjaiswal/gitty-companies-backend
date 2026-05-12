import { callLlmForJson } from "../app/external/llm/client.js";
import type {
  Skeleton,
  VariationAxis,
  VariationValue,
} from "../skeletons/types.js";
import type { Brief, TokenUsage } from "./types.js";
import {
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
} from "./variation-planner-prompts.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1500;
const TEMPERATURE = 0.4;
const MAX_NON_DEFAULT = 3;

export type VariationSelection = {
  axisId: string;
  value: VariationValue;
  rationale: string;
  isDefault: boolean;
};

export type VariationPlan = {
  selections: VariationSelection[];
  notApplicable: string[];
  overallRationale: string;
};

type RawPlannerResponse = {
  selections?: Array<{ axis_id?: string; value?: unknown; rationale?: string }>;
  not_applicable?: string[];
  overall_rationale?: string;
};

export async function planVariation(args: {
  brief: Brief;
  skeleton: Skeleton;
  model?: string;
}): Promise<{ plan: VariationPlan; usage: TokenUsage }> {
  const axes = args.skeleton.variation_axes ?? [];

  if (axes.length === 0) {
    return {
      plan: emptyPlan("Skeleton declares no variation axes — keeping rename-only behavior."),
      usage: { inputTokens: 0, outputTokens: 0, model: args.model ?? DEFAULT_MODEL },
    };
  }

  const system = buildPlannerSystemPrompt();
  const user = buildPlannerUserPrompt(args.brief, args.skeleton, axes);

  const { parsed, result } = await callLlmForJson<RawPlannerResponse>({
    model: args.model ?? DEFAULT_MODEL,
    maxTokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: user }],
    temperature: TEMPERATURE,
  });

  const plan = normalizePlan(parsed, axes);

  return {
    plan,
    usage: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      model: result.model,
    },
  };
}

function emptyPlan(rationale: string): VariationPlan {
  return { selections: [], notApplicable: [], overallRationale: rationale };
}

function normalizePlan(
  raw: RawPlannerResponse,
  axes: VariationAxis[],
): VariationPlan {
  const byId = new Map(axes.map((a) => [a.id, a]));
  const selections: VariationSelection[] = [];
  const notApplicable: string[] = [];
  const seen = new Set<string>();

  for (const sel of raw.selections ?? []) {
    if (!sel?.axis_id) continue;
    const axis = byId.get(sel.axis_id);
    if (!axis) continue;
    if (seen.has(axis.id)) continue;
    const coerced = coerceValue(sel.value, axis);
    if (coerced === undefined) continue;
    selections.push({
      axisId: axis.id,
      value: coerced,
      rationale: sel.rationale ?? "",
      isDefault: coerced === axis.default,
    });
    seen.add(axis.id);
  }

  for (const id of raw.not_applicable ?? []) {
    if (typeof id !== "string") continue;
    if (!byId.has(id) || seen.has(id)) continue;
    notApplicable.push(id);
    seen.add(id);
  }

  // Backfill any unseen axes as not_applicable to keep the contract complete.
  for (const axis of axes) {
    if (!seen.has(axis.id)) {
      notApplicable.push(axis.id);
    }
  }

  // Enforce at most MAX_NON_DEFAULT non-default selections — collapse extras to defaults.
  const nonDefaults = selections.filter((s) => !s.isDefault);
  if (nonDefaults.length > MAX_NON_DEFAULT) {
    const keep = new Set(nonDefaults.slice(0, MAX_NON_DEFAULT).map((s) => s.axisId));
    for (const s of selections) {
      if (!s.isDefault && !keep.has(s.axisId)) {
        const axis = byId.get(s.axisId);
        if (axis) s.value = axis.default;
        s.isDefault = true;
        s.rationale = `${s.rationale} (overridden — exceeded max non-default cap of ${MAX_NON_DEFAULT})`;
      }
    }
  }

  return {
    selections,
    notApplicable,
    overallRationale: raw.overall_rationale ?? "",
  };
}

function coerceValue(
  raw: unknown,
  axis: VariationAxis,
): VariationValue | undefined {
  if (axis.kind === "enum") {
    if (typeof raw !== "string") return undefined;
    return axis.values.includes(raw) ? raw : undefined;
  }
  if (axis.kind === "range") {
    const num = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(num) || !Number.isInteger(num)) return undefined;
    if (num < axis.min || num > axis.max) return undefined;
    return num;
  }
  if (axis.kind === "bool") {
    if (typeof raw === "boolean") return raw;
    if (raw === "true") return true;
    if (raw === "false") return false;
    return undefined;
  }
  return undefined;
}

/**
 * Resolve final value for every axis (chosen or default).
 * Useful for the executor — it needs concrete values, not selections + notApplicable.
 */
export function resolveAllAxes(
  plan: VariationPlan,
  axes: VariationAxis[],
): Record<string, VariationValue> {
  const out: Record<string, VariationValue> = {};
  const selById = new Map(plan.selections.map((s) => [s.axisId, s]));
  for (const axis of axes) {
    const sel = selById.get(axis.id);
    out[axis.id] = sel ? sel.value : axis.default;
  }
  return out;
}
