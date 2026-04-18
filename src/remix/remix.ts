import { loadSkeleton } from "../skeletons/loader.js";
import { RepoExecutor } from "../validation/index.js";
import { extractBrief } from "./extract-brief.js";
import { agentAdapt } from "./agent-adapt.js";
import { agentRepair } from "./agent-repair.js";
import { generateInstructionsBrief } from "./generate-brief.js";
import type { AdaptMetrics, RemixOptions, RemixResult, TokenUsage } from "./types.js";

/**
 * Remix a skeleton into a company-specific assessment.
 *
 * Pipeline: loadSkeleton → extractBrief → agentAdapt → (agentRepair if needed)
 * The primary agent edits files in-place, runs tsc/vitest, self-heals, and
 * writes _remix_metadata.json. If it exits with verification still failing,
 * a narrower repair agent gets a fresh context window and the specific errors.
 */
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
        // Repair may have touched files and/or written _remix_metadata.json — re-materialize workspace.
        workspace = await rehydrateWorkspace(executor, loaded.manifest, primary.workspace);
      }
    }

    const errors: string[] = [];
    if (!verified) {
      if (tscOutput) errors.push(`tsc:\n${tscOutput}`);
      if (vitestOutput) errors.push(`vitest:\n${vitestOutput}`);
      if (errors.length === 0) errors.push("Post-agent verification failed (no error output captured)");
    }

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

    return {
      brief,
      workspace,
      validation: {
        tscPass: verified,
        vitestPass: verified,
        overallPass: verified,
        errors,
      },
      instructionsMd,
      usage: {
        extract: extractUsage,
        adapt: adaptMetrics,
        ...(briefUsage ? { brief: briefUsage } : {}),
      },
    };
  } finally {
    await executor.cleanup();
  }
}

/**
 * After repair succeeds, re-read files + metadata from disk so the returned
 * workspace reflects the repaired state.
 */
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
    // Metadata missing or unparseable — keep whatever the primary pass produced.
  }

  return { files, scenario, tasks, rubric };
}
