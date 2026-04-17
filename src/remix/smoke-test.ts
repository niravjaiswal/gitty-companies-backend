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
  "react-orders-board": `
    HarborCart is hiring a Frontend Engineer to improve a React fulfillment board used by warehouse coordinators.
    The role emphasizes reducer-driven state management, filtering, order detail workflows, and interaction tests.
    Candidates are expected to wire together composable UI pieces without breaking the existing Vite app shell.
  `,
  "data-pipeline-insights": `
    SignalLoop is hiring a Data Engineer to maintain a TypeScript telemetry pipeline that processes both
    batch exports and object-mode event streams. The work centers on aggregations, streaming windows,
    report assembly, and deterministic tests for pipeline correctness.
  `,
  "ops-cli-audit": `
    Northstar Platform is hiring an Infrastructure Engineer to maintain a TypeScript CLI used for release audits.
    The team needs better suppression matching for noisy operational checks while preserving the current report format,
    JSON output mode, and command-line ergonomics.
  `,
  "fullstack-support-hub": `
    BrightDesk is hiring a Full-Stack Engineer to evolve an internal support-ops dashboard with a React frontend
    and Node/Express API. The work spans shared domain logic, server routes, dashboard state, and risk scoring
    for escalation decisions, with end-to-end tests covering both client and server flows.
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

  const result = await remix({ skeletonId, jobBrief: brief });

  console.log("\n=== Results ===");
  console.log(`Brief: ${result.brief.company_name} — ${result.brief.role_title}`);
  console.log(`Scenario: ${result.workspace.scenario.title}`);
  console.log(`Validation: ${result.validation.overallPass ? "PASS" : "FAIL"}`);

  if (!result.validation.overallPass) {
    console.log("\nErrors:");
    for (const e of result.validation.errors) {
      console.log(`  - ${e.slice(0, 200)}`);
    }
  }

  const { primary, repair } = result.usage.adapt;
  console.log(`\nToken usage:`);
  console.log(`  Extract: ${result.usage.extract.inputTokens} in / ${result.usage.extract.outputTokens} out (${result.usage.extract.model})`);
  console.log(
    `  Primary: ${primary.inputTokens} in / ${primary.outputTokens} out | $${primary.totalCostUsd.toFixed(3)} | ${primary.turns} turns | ${Math.round(primary.durationMs / 1000)}s | verified=${primary.verified}`,
  );
  if (repair) {
    console.log(
      `  Repair:  ${repair.inputTokens} in / ${repair.outputTokens} out | $${repair.totalCostUsd.toFixed(3)} | ${repair.turns} turns | ${Math.round(repair.durationMs / 1000)}s | verified=${repair.verified}`,
    );
  }
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
