/**
 * Smoke test: run the remix pipeline against a skeleton with a sample brief.
 *
 * Usage: npx tsx src/remix/smoke-test.ts [skeleton-id]
 */
import { remix } from "./remix.js";

const useAgent = process.argv.includes("--agent");
const skeletonId = process.argv.filter((a) => !a.startsWith("--"))[2] || "rest-api-express";

const SAMPLE_BRIEFS: Record<string, string> = {
  "rest-api-express": `
    CloudVault is hiring a Mid-Level Backend Engineer to join our file storage platform team.
    You'll work on our Node.js/Express REST APIs that power our cloud document management system.
    We use TypeScript, PostgreSQL, and Redis. The role involves building CRUD endpoints for
    managing documents and folders, with a focus on proper validation, error handling, and
    test coverage. Experience with REST API design patterns and automated testing is required.
  `,
  "pulseboard-launch-sprint": `
    NovaPay is hiring a Frontend Engineer to build dashboards for their payment processing platform.
    The role involves React, TypeScript, and state management for complex financial data visualization.
    You'll implement interactive components for transaction monitoring, payment status tracking,
    and merchant analytics. Strong component architecture and testing skills required.
  `,
};

const brief = SAMPLE_BRIEFS[skeletonId];
if (!brief) {
  console.error(`No sample brief for skeleton: ${skeletonId}`);
  console.error(`Available: ${Object.keys(SAMPLE_BRIEFS).join(", ")}`);
  process.exit(1);
}

async function main() {
  console.error(`\n=== Smoke Test: ${skeletonId}${useAgent ? " (AGENT)" : ""} ===\n`);

  const result = await remix({
    skeletonId,
    jobBrief: brief,
    maxRepairRounds: 1,
    useAgent,
  });

  console.log("\n=== Results ===");
  console.log(`Brief: ${result.brief.company_name} — ${result.brief.role_title}`);
  if (result.patch) {
    console.log(`Patch: ${result.patch.file_patches.length} files, ${result.patch.tasks.length} tasks`);
    console.log(`Scenario: ${result.patch.scenario.title}`);
  } else {
    console.log(`Scenario: ${result.workspace.scenario.title} (agent path — no patch)`);
  }
  console.log(`Validation: ${result.validation ? (result.validation.overallPass ? "PASS" : "FAIL") : "SKIPPED"}`);

  if (result.validation && !result.validation.overallPass) {
    console.log("\nErrors:");
    for (const e of result.validation.errors) {
      console.log(`  - ${e.slice(0, 200)}`);
    }
  }

  const adapt = result.usage.adapt;
  console.log(`\nToken usage:`);
  console.log(`  Extract: ${result.usage.extract.inputTokens} in / ${result.usage.extract.outputTokens} out (${result.usage.extract.model})`);
  if ("model" in adapt) {
    console.log(`  Adapt: ${adapt.inputTokens} in / ${adapt.outputTokens} out (${adapt.model})`);
  } else {
    console.log(`  Adapt (agent): ${adapt.inputTokens} in / ${adapt.outputTokens} out | $${adapt.totalCostUsd.toFixed(3)} | ${adapt.turns} turns | ${Math.round(adapt.durationMs / 1000)}s`);
  }
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
