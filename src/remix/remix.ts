import { loadSkeleton } from "../skeletons/loader.js";
import { RepoExecutor } from "../validation/index.js";
import { extractBrief } from "./extract-brief.js";
import { agentAdapt } from "./agent-adapt.js";
import { agentRepair } from "./agent-repair.js";
import { agentVary } from "./agent-vary.js";
import { generateInstructionsBrief } from "./generate-brief.js";
import { checkPathConsistency } from "./path-consistency.js";
import { planVariation } from "./variation-planner.js";
import { runAdversarial } from "../skeletons/scoring/adversarial/runner.js";
import { adversarialSourceFromWorkspace } from "../skeletons/scoring/adversarial/source.js";
import type { AdversarialReport } from "../skeletons/scoring/adversarial/types.js";
import type {
  AdaptMetrics,
  RemixOptions,
  RemixResult,
  TokenUsage,
  VaryMetrics,
} from "./types.js";
import type { PathConsistencyReport } from "./path-consistency.js";
import type { VariationPlan } from "./variation-planner.js";

export async function remix(options: RemixOptions): Promise<RemixResult> {
  const { skeletonId, jobBrief } = options;

  console.error(`[remix] Loading skeleton: ${skeletonId}`);
  const loaded = await loadSkeleton(skeletonId);

  console.error(`[remix] Extracting brief...`);
  const { brief, usage: extractUsage } = await extractBrief(jobBrief);
  console.error(`[remix] Brief extracted: ${brief.company_name} — ${brief.role_title}`);

  console.error(`[remix] Running agent adaptation...`);
  const executor = await RepoExecutor.create();
  try {
    await executor.writeFiles(new Map(Object.entries(loaded.files)));
    await executor.npmInstall();

    const primary = await agentAdapt(executor, brief, loaded.manifest);

    let verified = primary.verified;
    let tscOutput = primary.tscOutput;
    let vitestOutput = primary.vitestOutput;
    let workspace = primary.workspace;
    const adaptMetrics: AdaptMetrics = {
      primary: { ...primary.usage, verified: primary.verified },
      repair: null,
    };

    if (!primary.verified) {
      console.error(`[remix] Primary pass failed — running repair agent`);
      const repair = await agentRepair(executor, brief, loaded.manifest, tscOutput, vitestOutput);
      adaptMetrics.repair = { ...repair.usage, verified: repair.verified };
      verified = repair.verified;
      tscOutput = repair.tscOutput;
      vitestOutput = repair.vitestOutput;

      if (repair.verified) {
        workspace = await rehydrateWorkspace(executor, loaded.manifest, primary.workspace);
      }
    }

    const errors: string[] = [];
    if (!verified) {
      if (tscOutput) errors.push(`tsc:\n${tscOutput}`);
      if (vitestOutput) errors.push(`vitest:\n${vitestOutput}`);
      if (errors.length === 0) errors.push("Post-agent verification failed (no error output captured)");
    }

    // ── Variation pass ────────────────────────────────────────
    let variationPlan: VariationPlan | null = null;
    let varyMetrics: VaryMetrics | undefined;
    const axes = loaded.skeleton.variation_axes ?? [];

    if (verified && !options.skipVary && axes.length > 0) {
      console.error(`[remix] Planning variation across ${axes.length} declared axes...`);
      const { plan, usage: plannerUsage } = await planVariation({
        brief,
        skeleton: loaded.skeleton,
      });
      variationPlan = plan;
      const nonDefaultCount = plan.selections.filter((s) => !s.isDefault).length;
      console.error(
        `[remix] Plan: ${nonDefaultCount} non-default selection(s), ${plan.notApplicable.length} N/A`,
      );

      varyMetrics = {
        planner: {
          ...plannerUsage,
          axesCount: axes.length,
          nonDefaultCount,
        },
        executor: null,
        metadata: null,
      };

      if (nonDefaultCount > 0) {
        console.error(`[remix] Applying variations via executor agent...`);
        const vary = await agentVary({
          executor,
          brief,
          manifest: loaded.manifest,
          plan,
          axes,
        });
        varyMetrics.executor = {
          ...vary.usage,
          verified: vary.verified,
          sacredViolations: vary.sacredViolations,
        };
        varyMetrics.metadata = vary.metadata;

        if (!vary.verified) {
          verified = false;
          if (vary.tscOutput) errors.push(`vary tsc:\n${vary.tscOutput}`);
          if (vary.vitestOutput) errors.push(`vary vitest:\n${vary.vitestOutput}`);
          console.error(
            `[remix] Variation pass FAILED — tsc=${!vary.tscOutput} vitest=${!vary.vitestOutput}`,
          );
        }

        if (vary.sacredViolations.length > 0) {
          verified = false;
          for (const v of vary.sacredViolations) errors.push(`sacred: ${v}`);
          console.error(
            `[remix] Variation broke sacred anchors (${vary.sacredViolations.length})`,
          );
        }

        if (verified) {
          workspace = await rehydrateWorkspace(executor, loaded.manifest, workspace);
        }
      } else {
        console.error(`[remix] Plan returned all defaults — no executor pass needed`);
      }
    } else if (axes.length === 0) {
      console.error(`[remix] Skeleton declares no variation axes — skipping vary pass`);
    } else if (options.skipVary) {
      console.error(`[remix] skipVary set — bypassing variation pass`);
    }

    // ── Instructions + path consistency ───────────────────────
    let instructionsMd = "";
    let briefUsage: TokenUsage | undefined;
    if (verified) {
      try {
        console.error(`[remix] Generating candidate-facing instructions brief...`);
        const briefResult = await generateInstructionsBrief({
          brief,
          assessmentCopy: loaded.skeleton.assessment_copy,
          examSpecifics: options.examSpecifics,
          scenario: workspace.scenario,
          tasks: workspace.tasks,
          rubric: workspace.rubric,
          partCount: options.partCount ?? 1,
        });
        instructionsMd = briefResult.instructionsMd;
        briefUsage = briefResult.usage;
      } catch (err) {
        console.error(
          "[remix] generateInstructionsBrief threw — continuing with empty instructionsMd",
          err,
        );
      }
    }

    let consistency: PathConsistencyReport = { pass: true, pathIssues: [], scriptIssues: [] };
    if (verified) {
      consistency = checkPathConsistency({ instructionsMd, workspace });
      const pathErrors = consistency.pathIssues.filter((i) => i.severity === "error");
      const scriptErrors = consistency.scriptIssues.filter((i) => i.severity === "error");
      const pathWarnings = consistency.pathIssues.filter((i) => i.severity === "warning");

      for (const issue of pathErrors) {
        const hint = issue.suggestion ? ` (did you mean ${issue.suggestion}?)` : "";
        errors.push(`path: ${issue.source} references missing ${issue.path}${hint}`);
      }
      for (const issue of scriptErrors) {
        errors.push(`script: ${issue.source} references missing npm script "${issue.script}"`);
      }

      if (!consistency.pass) {
        const sample = [...pathErrors, ...scriptErrors]
          .slice(0, 3)
          .map((i) => ("path" in i ? `${i.source}:${i.path}` : `${i.source}:script:${i.script}`))
          .join(", ");
        console.error(
          `[remix] Path consistency FAILED — ${pathErrors.length} path error(s), ${scriptErrors.length} script error(s), ${pathWarnings.length} warning(s); first: ${sample}`,
        );
      } else if (pathWarnings.length > 0) {
        console.error(`[remix] Path consistency passed with ${pathWarnings.length} warning(s)`);
      }
    }

    // ── Adversarial post-gen gate ─────────────────────────────
    let adversarial: AdversarialReport | null = null;
    if (verified && consistency.pass && !options.skipAdversarial) {
      try {
        console.error(`[remix] Running adversarial post-gen gate...`);
        const source = adversarialSourceFromWorkspace({
          name: `${brief.company_name}-${brief.role_title}`.replace(/\s+/g, "-").toLowerCase(),
          manifest: loaded.manifest,
          files: workspace.files,
          filesDir: executor.dir,
        });
        adversarial = await runAdversarial(source, { runs: 1 });
        console.error(
          `[remix] Adversarial verdict: ${adversarial.qualityVerdict} (solved=${(adversarial.aggregate.solvedRate * 100).toFixed(0)}%, edits=${adversarial.aggregate.medianEdits}, cost=$${adversarial.aggregate.avgCostUsd.toFixed(2)})`,
        );
        if (
          adversarial.qualityVerdict === "tests-cheated" ||
          adversarial.qualityVerdict === "broken-tests"
        ) {
          errors.push(`adversarial: ${adversarial.qualityVerdict} — ${adversarial.verdictRationale}`);
        }
      } catch (err) {
        console.error(`[remix] Adversarial gate threw (continuing): ${err}`);
      }
    } else if (options.skipAdversarial) {
      console.error(`[remix] skipAdversarial set — bypassing post-gen gate`);
    }

    const overallPass =
      verified &&
      consistency.pass &&
      (adversarial === null ||
        (adversarial.qualityVerdict !== "tests-cheated" &&
          adversarial.qualityVerdict !== "broken-tests"));

    return {
      brief,
      workspace,
      validation: {
        tscPass: verified,
        vitestPass: verified,
        overallPass,
        errors,
      },
      instructionsMd,
      consistency,
      variationPlan,
      adversarial,
      usage: {
        extract: extractUsage,
        adapt: adaptMetrics,
        ...(varyMetrics ? { vary: varyMetrics } : {}),
        ...(briefUsage ? { brief: briefUsage } : {}),
      },
    };
  } finally {
    await executor.cleanup();
  }
}

async function rehydrateWorkspace(
  executor: RepoExecutor,
  manifest: Awaited<ReturnType<typeof loadSkeleton>>["manifest"],
  fallback: RemixResult["workspace"],
): Promise<RemixResult["workspace"]> {
  const filesMap = await executor.readAllFiles(manifest.files.map((f) => f.path));
  const files: Record<string, string> = {};
  for (const [path, content] of filesMap) {
    files[path] = content;
  }

  let scenario = fallback.scenario;
  let tasks = fallback.tasks;
  let rubric = fallback.rubric;
  try {
    const raw = await executor.readFile("_remix_metadata.json");
    const parsed = JSON.parse(raw) as {
      scenario?: typeof scenario;
      tasks?: typeof tasks;
      rubric?: typeof rubric;
    };
    if (parsed.scenario) scenario = parsed.scenario;
    if (parsed.tasks) tasks = parsed.tasks;
    if (parsed.rubric) rubric = parsed.rubric;
  } catch {
    /* metadata missing or unparseable — keep fallback */
  }

  return { files, scenario, tasks, rubric };
}
