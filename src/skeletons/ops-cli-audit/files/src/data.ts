import type { AuditSnapshot } from "./types.js";

export const sampleSnapshot: AuditSnapshot = {
  environment: "production",
  capturedAt: "2026-04-15T08:00:00.000Z",
  checks: [
    {
      service: "billing",
      code: "latency-budget",
      status: "fail",
      message: "P95 latency reached 940ms against a 300ms budget.",
      owner: "payments-platform",
      durationMs: 940,
      budgetMs: 300,
    },
    {
      service: "deploy",
      code: "rollback-drill",
      status: "warn",
      message: "Rollback drill has not run for the latest canary.",
      owner: "release-eng",
    },
    {
      service: "search",
      code: "ownership",
      status: "pass",
      message: "Search index ownership is currently unassigned.",
    },
    {
      service: "notifications",
      code: "smoke-test",
      status: "pass",
      message: "All notification smoke checks passed.",
      owner: "core-platform",
    },
  ],
};
