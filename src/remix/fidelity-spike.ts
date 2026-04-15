/**
 * M3 Fidelity Spike: run 20 remixes (10 per skeleton) and measure pass rate.
 *
 * Go/no-go gate: ≥80% passing both tsc + vitest on BOTH skeletons.
 *
 * Usage: npx tsx src/remix/fidelity-spike.ts
 */
import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { remix } from "./remix.js";
import type { RemixResult } from "./types.js";

// ── Types ───────────────────────────────────────────────────────

interface SpikeBrief {
  label: string;
  skeletonId: string;
  brief: string;
}

interface RunResult {
  label: string;
  skeletonId: string;
  tscPass: boolean;
  vitestPass: boolean;
  bothPass: boolean;
  repairRounds: number;
  errors: string[];
  durationMs: number;
  tokens: { extractIn: number; extractOut: number; adaptIn: number; adaptOut: number };
  exception: string | null;
  useAgent: boolean;
  agentCostUsd?: number;
  agentTurns?: number;
}

// ── Briefs ──────────────────────────────────────────────────────

const BRIEFS: SpikeBrief[] = [
  // ── Pulseboard (frontend/dashboard) ──
  {
    label: "pulseboard-fintech",
    skeletonId: "pulseboard-launch-sprint",
    brief: `
      StripeWave is hiring a Junior Frontend Engineer for their payments dashboard team.
      You'll build React components for real-time transaction monitoring and payment status tracking.
      Tech stack: React, TypeScript, Vite. Focus on state management and component composition.
    `,
  },
  {
    label: "pulseboard-ecommerce",
    skeletonId: "pulseboard-launch-sprint",
    brief: `
      ShopGrid is hiring a Mid-Level Frontend Developer to work on their merchant analytics dashboard.
      The role involves building interactive data visualization components for order tracking,
      inventory alerts, and sales performance metrics. React, TypeScript, and testing with Vitest.
    `,
  },
  {
    label: "pulseboard-healthcare",
    skeletonId: "pulseboard-launch-sprint",
    brief: `
      MedTrack Health is hiring a Frontend Engineer to build a clinical trial monitoring dashboard.
      You'll implement React components for patient enrollment tracking, study milestone visualization,
      and compliance status boards. Strong TypeScript and component testing skills required.
    `,
  },
  {
    label: "pulseboard-devtools",
    skeletonId: "pulseboard-launch-sprint",
    brief: `
      BuildKite Pro is hiring a Senior Frontend Engineer for their CI/CD dashboard product.
      Build React components for pipeline status monitoring, build queue management,
      and deployment tracking. TypeScript, state management, and thorough test coverage expected.
    `,
  },
  {
    label: "pulseboard-logistics",
    skeletonId: "pulseboard-launch-sprint",
    brief: `
      FleetPulse is hiring a Frontend Developer to build their fleet management dashboard.
      The role involves React components for vehicle tracking, delivery status boards,
      and route optimization visualizations. TypeScript and Vitest testing required.
    `,
  },
  {
    label: "pulseboard-edtech",
    skeletonId: "pulseboard-launch-sprint",
    brief: `
      LearnLoop is hiring a Junior Frontend Engineer to work on their student progress dashboard.
      Build React components for course completion tracking, assignment status boards,
      and learning milestone visualization. TypeScript with component-level testing.
    `,
  },
  {
    label: "pulseboard-gaming",
    skeletonId: "pulseboard-launch-sprint",
    brief: `
      ArenaStats is hiring a Mid-Level Frontend Developer for their esports analytics platform.
      You'll build React dashboards for match statistics, player performance tracking,
      and tournament bracket visualization. TypeScript and state management expertise needed.
    `,
  },
  {
    label: "pulseboard-realestate",
    skeletonId: "pulseboard-launch-sprint",
    brief: `
      PropView is hiring a Frontend Engineer to build their property management dashboard.
      Implement React components for listing status tracking, tenant onboarding workflows,
      and maintenance request boards. TypeScript, React, and Vitest required.
    `,
  },
  {
    label: "pulseboard-sustainability",
    skeletonId: "pulseboard-launch-sprint",
    brief: `
      CarbonLens is hiring a Frontend Developer for their emissions monitoring dashboard.
      Build React components for carbon footprint tracking, sustainability goal visualization,
      and compliance milestone boards. TypeScript and thorough component testing.
    `,
  },
  {
    label: "pulseboard-saas",
    skeletonId: "pulseboard-launch-sprint",
    brief: `
      MetricFlow is hiring a Senior Frontend Engineer to build their SaaS analytics dashboard.
      The role involves React components for subscription metrics, churn tracking,
      and feature adoption visualization. Strong TypeScript and testing skills required.
    `,
  },

  // ── REST API Express (backend) ──
  {
    label: "restapi-fintech",
    skeletonId: "rest-api-express",
    brief: `
      LedgerBase is hiring a Junior Backend Engineer to build REST APIs for their accounting platform.
      You'll work on Express endpoints for managing invoices, payments, and account balances.
      TypeScript, Express, validation, and test coverage with Vitest and Supertest.
    `,
  },
  {
    label: "restapi-ecommerce",
    skeletonId: "rest-api-express",
    brief: `
      CartEngine is hiring a Mid-Level Backend Developer for their e-commerce order management API.
      Build Express REST endpoints for product catalog CRUD, cart operations, and order processing.
      TypeScript, proper error handling, and comprehensive API testing required.
    `,
  },
  {
    label: "restapi-healthcare",
    skeletonId: "rest-api-express",
    brief: `
      HealthBridge is hiring a Backend Engineer to build REST APIs for their patient records system.
      Implement Express endpoints for managing appointments, medical records, and prescription tracking.
      TypeScript, validation, and thorough test coverage expected.
    `,
  },
  {
    label: "restapi-devtools",
    skeletonId: "rest-api-express",
    brief: `
      DeployDog is hiring a Senior Backend Engineer for their deployment management API.
      Build Express REST endpoints for managing deployments, rollback operations, and environment configs.
      TypeScript, Express, error handling patterns, and Vitest/Supertest testing.
    `,
  },
  {
    label: "restapi-logistics",
    skeletonId: "rest-api-express",
    brief: `
      RouteSmith is hiring a Backend Developer to build REST APIs for their delivery routing platform.
      Implement Express endpoints for managing shipments, tracking deliveries, and route optimization.
      TypeScript, validation, and API testing with Supertest.
    `,
  },
  {
    label: "restapi-edtech",
    skeletonId: "rest-api-express",
    brief: `
      QuizForge is hiring a Junior Backend Engineer for their assessment platform API.
      Build Express REST endpoints for managing quizzes, student submissions, and grading workflows.
      TypeScript, proper input validation, and test-driven development with Vitest.
    `,
  },
  {
    label: "restapi-gaming",
    skeletonId: "rest-api-express",
    brief: `
      GuildKeeper is hiring a Mid-Level Backend Developer for their game server management API.
      Implement Express endpoints for player profiles, inventory management, and leaderboard operations.
      TypeScript, CRUD patterns, and comprehensive test coverage.
    `,
  },
  {
    label: "restapi-realestate",
    skeletonId: "rest-api-express",
    brief: `
      NestFind is hiring a Backend Engineer to build REST APIs for their property listing platform.
      Build Express endpoints for managing listings, inquiries, and viewing schedules.
      TypeScript, validation, error handling, and Vitest/Supertest testing.
    `,
  },
  {
    label: "restapi-sustainability",
    skeletonId: "rest-api-express",
    brief: `
      GreenLedger is hiring a Backend Developer for their carbon credit trading API.
      Implement Express REST endpoints for managing carbon credits, trade operations, and audit logs.
      TypeScript, Express, and thorough API test coverage.
    `,
  },
  {
    label: "restapi-saas",
    skeletonId: "rest-api-express",
    brief: `
      TenantHub is hiring a Senior Backend Engineer for their multi-tenant SaaS platform API.
      Build Express endpoints for managing tenants, subscription plans, and usage metering.
      TypeScript, proper error handling, validation, and comprehensive testing.
    `,
  },
];

// ── Runner ──────────────────────────────────────────────────────

function isTransientError(msg: string): boolean {
  return (
    msg.includes("Connection error") ||
    msg.includes("ECONNRESET") ||
    msg.includes("rate limit") ||
    msg.includes("overloaded") ||
    msg.includes("529") ||
    msg.includes("503")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOne(sb: SpikeBrief, useAgent: boolean): Promise<RunResult> {
  const start = Date.now();

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result: RemixResult = await remix({
        skeletonId: sb.skeletonId,
        jobBrief: sb.brief,
        maxRepairRounds: 1,
        useAgent,
      });

      const v = result.validation!;
      const adapt = result.usage.adapt;
      const isAgentUsage = "totalCostUsd" in adapt;

      return {
        label: sb.label,
        skeletonId: sb.skeletonId,
        tscPass: v.tscPass,
        vitestPass: v.vitestPass,
        bothPass: v.overallPass,
        repairRounds: v.repairRounds,
        errors: v.errors,
        durationMs: Date.now() - start,
        tokens: {
          extractIn: result.usage.extract.inputTokens,
          extractOut: result.usage.extract.outputTokens,
          adaptIn: adapt.inputTokens,
          adaptOut: adapt.outputTokens,
        },
        exception: null,
        useAgent,
        agentCostUsd: isAgentUsage ? adapt.totalCostUsd : undefined,
        agentTurns: isAgentUsage ? adapt.turns : undefined,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      // Retry once on transient errors
      if (attempt === 0 && isTransientError(msg)) {
        console.error(`  ⟳ Transient error, retrying in 10s: ${msg.slice(0, 100)}`);
        await sleep(10_000);
        continue;
      }

      return {
        label: sb.label,
        skeletonId: sb.skeletonId,
        tscPass: false,
        vitestPass: false,
        bothPass: false,
        repairRounds: 0,
        errors: [msg],
        durationMs: Date.now() - start,
        tokens: { extractIn: 0, extractOut: 0, adaptIn: 0, adaptOut: 0 },
        exception: msg,
        useAgent,
      };
    }
  }

  // unreachable, but TypeScript needs it
  throw new Error("runOne: unexpected loop exit");
}

// ── Report ──────────────────────────────────────────────────────

function printReport(results: RunResult[]) {
  const skeletons = [...new Set(results.map((r) => r.skeletonId))];

  console.log("\n" + "=".repeat(70));
  console.log("  M3 FIDELITY SPIKE — RESULTS");
  console.log("=".repeat(70));

  let allPass = true;

  for (const sid of skeletons) {
    const subset = results.filter((r) => r.skeletonId === sid);
    const tscCount = subset.filter((r) => r.tscPass).length;
    const vitestCount = subset.filter((r) => r.vitestPass).length;
    const bothCount = subset.filter((r) => r.bothPass).length;
    const n = subset.length;

    const tscRate = Math.round((tscCount / n) * 100);
    const vitestRate = Math.round((vitestCount / n) * 100);
    const bothRate = Math.round((bothCount / n) * 100);

    const skeletonPass = bothRate >= 80;
    if (!skeletonPass) allPass = false;

    console.log(`\n── ${sid} (${n} runs) ${"─".repeat(Math.max(0, 50 - sid.length))}`);
    console.log(`  tsc pass:    ${tscCount}/${n}  (${tscRate}%)`);
    console.log(`  vitest pass: ${vitestCount}/${n}  (${vitestRate}%)`);
    console.log(`  both pass:   ${bothCount}/${n}  (${bothRate}%)  ${skeletonPass ? "✓ PASS" : "✗ FAIL"}`);

    // Repair stats
    const repairRuns = subset.filter((r) => r.repairRounds > 0);
    if (repairRuns.length > 0) {
      console.log(`  repairs:     ${repairRuns.length}/${n} runs needed repair`);
    }

    // Token stats
    const totalAdaptOut = subset.reduce((s, r) => s + r.tokens.adaptOut, 0);
    const avgAdaptOut = Math.round(totalAdaptOut / n);
    console.log(`  avg adapt output tokens: ${avgAdaptOut}`);

    // Agent-specific stats
    const agentRuns = subset.filter((r) => r.agentCostUsd != null);
    if (agentRuns.length > 0) {
      const avgCost = agentRuns.reduce((s, r) => s + (r.agentCostUsd ?? 0), 0) / agentRuns.length;
      const avgTurns = Math.round(agentRuns.reduce((s, r) => s + (r.agentTurns ?? 0), 0) / agentRuns.length);
      console.log(`  avg agent cost: $${avgCost.toFixed(3)}`);
      console.log(`  avg agent turns: ${avgTurns}`);
    }

    // Duration stats
    const avgDuration = Math.round(subset.reduce((s, r) => s + r.durationMs, 0) / n / 1000);
    console.log(`  avg duration: ${avgDuration}s`);

    // Failures
    const failures = subset.filter((r) => !r.bothPass);
    if (failures.length > 0) {
      console.log(`\n  Failures:`);
      for (const f of failures) {
        const reason = f.exception
          ? `EXCEPTION: ${f.exception.slice(0, 120)}`
          : f.errors.slice(0, 3).join("; ").slice(0, 200);
        console.log(`    ${f.label}: ${reason}`);
      }
    }
  }

  // Overall verdict
  const totalBoth = results.filter((r) => r.bothPass).length;
  const overallRate = Math.round((totalBoth / results.length) * 100);

  console.log("\n" + "=".repeat(70));
  console.log(`  OVERALL: ${totalBoth}/${results.length} (${overallRate}%)`);
  console.log(`  VERDICT: ${allPass ? "✓ GO — proceed to M4-M8" : "✗ NO-GO — investigate failures before proceeding"}`);
  console.log("=".repeat(70) + "\n");
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const useAgent = process.argv.includes("--agent");
  const modeLabel = useAgent ? "AGENT" : "LEGACY";

  console.error(`\n=== M3 Fidelity Spike (${modeLabel}): ${BRIEFS.length} remixes ===\n`);

  const results: RunResult[] = [];

  for (let i = 0; i < BRIEFS.length; i++) {
    const sb = BRIEFS[i];
    console.error(`[${i + 1}/${BRIEFS.length}] ${sb.label} (${sb.skeletonId})...`);

    if (i > 0) await sleep(3000); // cooldown between runs to avoid rate limiting

    const result = await runOne(sb, useAgent);
    results.push(result);

    const status = result.bothPass ? "PASS" : "FAIL";
    const repair = result.repairRounds > 0 ? ` (${result.repairRounds} repair)` : "";
    const agentInfo = result.agentCostUsd != null ? ` | $${result.agentCostUsd.toFixed(3)} ${result.agentTurns}t` : "";
    console.error(
      `  → ${status}${repair} | tsc=${result.tscPass} vitest=${result.vitestPass} | ${Math.round(result.durationMs / 1000)}s${agentInfo}`,
    );
  }

  // Print report to stdout
  printReport(results);

  // Save full results to JSON
  await mkdir("output", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = `output/fidelity-spike-${timestamp}.json`;

  const summary = {
    timestamp: new Date().toISOString(),
    totalRuns: results.length,
    totalPass: results.filter((r) => r.bothPass).length,
    overallRate: Math.round((results.filter((r) => r.bothPass).length / results.length) * 100),
    perSkeleton: Object.fromEntries(
      [...new Set(results.map((r) => r.skeletonId))].map((sid) => {
        const subset = results.filter((r) => r.skeletonId === sid);
        return [
          sid,
          {
            runs: subset.length,
            tscPass: subset.filter((r) => r.tscPass).length,
            vitestPass: subset.filter((r) => r.vitestPass).length,
            bothPass: subset.filter((r) => r.bothPass).length,
            rate: Math.round((subset.filter((r) => r.bothPass).length / subset.length) * 100),
          },
        ];
      }),
    ),
  };

  await writeFile(outPath, JSON.stringify({ summary, results }, null, 2));
  console.error(`\nResults saved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fidelity spike failed:", err);
  process.exit(1);
});
