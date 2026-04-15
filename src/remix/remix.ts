import { loadSkeleton } from "../skeletons/loader.js";
import { RepoExecutor } from "../validation/index.js";
import { extractBrief } from "./extract-brief.js";
import { adaptSkeleton } from "./adapt-skeleton.js";
import { applyPatch } from "./apply-patch.js";
import { validateRemix } from "./validate-remix.js";
import { agentAdapt } from "./agent-adapt.js";
import type { RemixOptions, RemixResult } from "./types.js";

/**
 * Remix a skeleton into a company-specific assessment.
 *
 * Legacy pipeline: loadSkeleton → extractBrief → adaptSkeleton → applyPatch → validateRemix
 * Agent pipeline:  loadSkeleton → extractBrief → agentAdapt (edits in-place, runs tsc/vitest)
 */
export async function remix(options: RemixOptions): Promise<RemixResult> {
  const { skeletonId, jobBrief, maxRepairRounds, skipValidation, useAgent } = options;

  console.error(`[remix] Loading skeleton: ${skeletonId}`);
  const loaded = await loadSkeleton(skeletonId);

  console.error(`[remix] Extracting brief...`);
  const { brief, usage: extractUsage } = await extractBrief(jobBrief);
  console.error(`[remix] Brief extracted: ${brief.company_name} — ${brief.role_title}`);

  if (useAgent) {
    // ── Agent path: edits files directly, runs tsc/vitest ──────
    console.error(`[remix] Using agent adaptation path...`);
    const executor = await RepoExecutor.create();
    try {
      await executor.writeFiles(new Map(Object.entries(loaded.files)));
      await executor.npmInstall();

      const result = await agentAdapt(executor, brief, loaded.manifest);

      return {
        brief,
        patch: null,
        workspace: result.workspace,
        validation: {
          tscPass: result.verified,
          vitestPass: result.verified,
          overallPass: result.verified,
          repairRounds: 0,
          errors: result.verified ? [] : ["Post-agent verification failed"],
        },
        usage: {
          extract: extractUsage,
          adapt: result.usage,
        },
      };
    } finally {
      await executor.cleanup();
    }
  }

  // ── Legacy path: single-shot adapt + apply + validate ────────
  console.error(`[remix] Adapting skeleton...`);
  const { patch, usage: adaptUsage } = await adaptSkeleton(loaded, brief);
  console.error(
    `[remix] Patch produced: ${patch.file_patches.length} file(s), ${patch.tasks.length} task(s)`,
  );

  console.error(`[remix] Applying patch...`);
  const { workspace, warnings } = applyPatch(loaded, patch);
  for (const w of warnings) {
    console.error(`[remix]   warning: ${w}`);
  }

  let validation = null;
  if (!skipValidation) {
    console.error(`[remix] Validating remixed workspace...`);
    validation = await validateRemix(workspace, loaded.manifest, { maxRepairRounds });
    console.error(
      `[remix] Validation: tsc=${validation.tscPass}, vitest=${validation.vitestPass}, repairs=${validation.repairRounds}`,
    );
  }

  console.error(`[remix] Done.`);
  return {
    brief,
    patch,
    workspace,
    validation,
    usage: {
      extract: extractUsage,
      adapt: adaptUsage,
    },
  };
}
