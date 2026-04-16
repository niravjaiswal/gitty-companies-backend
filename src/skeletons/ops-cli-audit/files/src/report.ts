import type { AuditReport } from "./types.js";

function formatSeverityCounts(report: AuditReport): string {
  return `${report.totals.findings} findings (${report.totals.high} high, ${report.totals.medium} medium, ${report.totals.low} low)`;
}

export function formatTextReport(report: AuditReport): string {
  const lines: string[] = [];

  lines.push("Ops CLI Audit");
  lines.push(`Environment: ${report.environment}`);
  lines.push(`Captured: ${report.capturedAt}`);
  lines.push(
    `Checks: ${report.totals.checks} | ${formatSeverityCounts(report)}`,
  );
  lines.push("");
  lines.push("Findings");

  if (report.findings.length === 0) {
    lines.push("- No actionable findings");
  } else {
    for (const finding of report.findings) {
      lines.push(
        `- [${finding.severity}] ${finding.service}:${finding.code} - ${finding.message}`,
      );
    }
  }

  lines.push("");
  lines.push("Services");

  for (const service of report.services) {
    const severity = service.highestSeverity ?? "none";
    lines.push(
      `- ${service.service}: ${service.checks} checks, ${service.findings} findings, highest=${severity}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function formatJsonReport(report: AuditReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
