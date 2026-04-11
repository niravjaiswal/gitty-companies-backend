import { loadSkeleton } from "../skeletons/loader.js";
import { extractBrief } from "./extract-brief.js";
import { adaptSkeleton } from "./adapt-skeleton.js";
import { applyPatch } from "./apply-patch.js";
import { validateRemix } from "./validate-remix.js";
import type { RemixOptions, RemixResult } from "./types.js";

/**
 * Remix a skeleton into a company-specific assessment.
 *
 * Pipeline: loadSkeleton → extractBrief → adaptSkeleton → applyPatch → validateRemix
 */
export async function remix(options: RemixOptions): Promise<RemixResult> {
  const { skeletonId, jobBrief, maxRepairRounds, skipValidation } = options;

  console.error(`[remix] Loading skeleton: ${skeletonId}`);
  const loaded = await loadSkeleton(skeletonId);

  console.error(`[remix] Extracting brief...`);
  const { brief, usage: extractUsage } = await extractBrief(jobBrief);
  console.error(`[remix] Brief extracted: ${brief.company_name} — ${brief.role_title}`);

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
