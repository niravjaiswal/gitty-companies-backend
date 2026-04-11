/**
 * Smoke test: run the remix pipeline against a skeleton with a sample brief.
 *
 * Usage: npx tsx src/remix/smoke-test.ts [skeleton-id]
 */
import { remix } from "./remix.js";

const skeletonId = process.argv[2] || "rest-api-express";

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
  console.error(`\n=== Smoke Test: ${skeletonId} ===\n`);

  const result = await remix({
    skeletonId,
    jobBrief: brief,
    maxRepairRounds: 1,
  });

  console.log("\n=== Results ===");
  console.log(`Brief: ${result.brief.company_name} — ${result.brief.role_title}`);
  console.log(`Patch: ${result.patch.file_patches.length} files, ${result.patch.tasks.length} tasks`);
  console.log(`Scenario: ${result.patch.scenario.title}`);
  console.log(`Validation: ${result.validation ? (result.validation.overallPass ? "PASS" : "FAIL") : "SKIPPED"}`);

  if (result.validation && !result.validation.overallPass) {
    console.log("\nErrors:");
    for (const e of result.validation.errors) {
      console.log(`  - ${e.slice(0, 200)}`);
    }
  }

  console.log(`\nToken usage:`);
  console.log(`  Extract: ${result.usage.extract.inputTokens} in / ${result.usage.extract.outputTokens} out (${result.usage.extract.model})`);
  console.log(`  Adapt: ${result.usage.adapt.inputTokens} in / ${result.usage.adapt.outputTokens} out (${result.usage.adapt.model})`);
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
