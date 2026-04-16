import { describe, expect, it } from "vitest";
import { sampleSnapshot } from "../data.js";
import {
  evaluateSnapshot,
  parseAuditSnapshot,
} from "../audit.js";
import { suppressFindings } from "../filter.js";
import type { Finding } from "../types.js";

describe("parseAuditSnapshot", () => {
  it("parses a valid snapshot", () => {
    const parsed = parseAuditSnapshot(JSON.stringify(sampleSnapshot));
    expect(parsed.environment).toBe("production");
    expect(parsed.checks).toHaveLength(4);
  });

  it("rejects malformed snapshots", () => {
    expect(() => parseAuditSnapshot("{}")).toThrow(/checks array/i);
  });
});

describe("evaluateSnapshot", () => {
  it("builds findings and service summaries", () => {
    const report = evaluateSnapshot(sampleSnapshot);

    expect(report.totals.checks).toBe(4);
    expect(report.totals.findings).toBe(4);
    expect(report.totals.high).toBe(1);
    expect(report.totals.medium).toBe(1);
    expect(report.totals.low).toBe(2);

    expect(report.findings.map((finding) => finding.severity)).toEqual([
      "high",
      "medium",
      "low",
      "low",
    ]);

    expect(report.services).toEqual([
      { service: "billing", checks: 1, findings: 2, highestSeverity: "high" },
      { service: "deploy", checks: 1, findings: 1, highestSeverity: "medium" },
      {
        service: "notifications",
        checks: 1,
        findings: 0,
        highestSeverity: null,
      },
      { service: "search", checks: 1, findings: 1, highestSeverity: "low" },
    ]);
  });
});

describe("suppressFindings", () => {
  it("removes exact service:code matches", () => {
    const findings: Finding[] = [
      {
        service: "billing",
        code: "latency-budget",
        severity: "high",
        message: "billing issue",
        evidence: [],
      },
      {
        service: "search",
        code: "ownership",
        severity: "low",
        message: "search issue",
        evidence: [],
      },
    ];

    expect(suppressFindings(findings, ["billing:latency-budget"]))
      .toEqual([
        {
          service: "search",
          code: "ownership",
          severity: "low",
          message: "search issue",
          evidence: [],
        },
      ]);
  });
});
