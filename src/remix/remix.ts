import { loadSkeleton } from "../skeletons/loader.js";
import { RepoExecutor } from "../validation/index.js";
import { extractBrief } from "./extract-brief.js";
import { agentAdapt } from "./agent-adapt.js";
import type { RemixOptions, RemixResult } from "./types.js";

/**
 * Remix a skeleton into a company-specific assessment.
 *
 * Pipeline: loadSkeleton → extractBrief → agentAdapt
 * The agent edits files in-place inside a temp workspace, runs tsc/vitest,
 * self-heals, and writes _remix_metadata.json. After it stops we run our own
 * tsc+vitest verification gate.
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

    const result = await agentAdapt(executor, brief, loaded.manifest);

    return {
      brief,
      workspace: result.workspace,
      validation: {
        tscPass: result.verified,
        vitestPass: result.verified,
        overallPass: result.verified,
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
