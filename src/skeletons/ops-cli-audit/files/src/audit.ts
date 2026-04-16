import { suppressFindings } from "./filter.js";
import type {
  AuditCheck,
  AuditReport,
  AuditSnapshot,
  Finding,
  Severity,
  ServiceSummary,
} from "./types.js";

const STATUS_TO_SEVERITY: Record<"fail" | "warn", Severity> = {
  fail: "high",
  warn: "medium",
};

const SEVERITY_RANK: Record<Severity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Expected ${label} to be a non-empty string`);
  }
  return value;
}

function assertOptionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected ${label} to be a finite number`);
  }
  return value;
}

function parseCheck(value: unknown, index: number): AuditCheck {
  if (!value || typeof value !== "object") {
    throw new Error(`Check ${index + 1} must be an object`);
  }

  const record = value as Record<string, unknown>;
  const status = record.status;
  if (status !== "pass" && status !== "warn" && status !== "fail") {
    throw new Error(`Check ${index + 1} has an invalid status`);
  }

  return {
    service: assertString(record.service, `check ${index + 1} service`),
    code: assertString(record.code, `check ${index + 1} code`),
    status,
    message: assertString(record.message, `check ${index + 1} message`),
    owner:
      typeof record.owner === "string" && record.owner.trim() !== ""
        ? record.owner
        : undefined,
    durationMs: assertOptionalNumber(record.durationMs, `check ${index + 1} durationMs`),
    budgetMs: assertOptionalNumber(record.budgetMs, `check ${index + 1} budgetMs`),
  };
}

export function parseAuditSnapshot(raw: string): AuditSnapshot {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Audit snapshot must be a JSON object");
  }

  const snapshot = parsed as Record<string, unknown>;
  const checks = snapshot.checks;
  if (!Array.isArray(checks)) {
    throw new Error("Audit snapshot must include a checks array");
  }

  return {
    environment: assertString(snapshot.environment, "environment"),
    capturedAt: assertString(snapshot.capturedAt, "capturedAt"),
    checks: checks.map((check, index) => parseCheck(check, index)),
  };
}

function makeFinding(
  service: string,
  code: string,
  severity: Severity,
  message: string,
  evidence: string[],
): Finding {
  return { service, code, severity, message, evidence };
}

function collectFindings(checks: AuditCheck[]): Finding[] {
  const findings: Finding[] = [];

  for (const check of checks) {
    if (check.status in STATUS_TO_SEVERITY) {
      findings.push(
        makeFinding(
          check.service,
          check.code,
          STATUS_TO_SEVERITY[check.status as "fail" | "warn"],
          check.message,
          [`status=${check.status}`],
        ),
      );
    }

    if (!check.owner) {
      findings.push(
        makeFinding(
          check.service,
          "ownership",
          "low",
          `${check.service} does not have an owner assigned`,
          [`check=${check.code}`],
        ),
      );
    }

    if (
      check.durationMs !== undefined &&
      check.budgetMs !== undefined &&
      check.durationMs > check.budgetMs
    ) {
      findings.push(
        makeFinding(
          check.service,
          "latency-overrun",
          "low",
          `${check.service} exceeded its latency budget`,
          [
            `durationMs=${check.durationMs}`,
            `budgetMs=${check.budgetMs}`,
          ],
        ),
      );
    }
  }

  return findings;
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severityDiff !== 0) {
      return severityDiff;
    }

    const serviceDiff = a.service.localeCompare(b.service);
    if (serviceDiff !== 0) {
      return serviceDiff;
    }

    return a.code.localeCompare(b.code);
  });
}

function summarizeServices(
  checks: AuditCheck[],
  findings: Finding[],
): ServiceSummary[] {
  const serviceNames = new Set<string>();
  for (const check of checks) {
    serviceNames.add(check.service);
  }

  return [...serviceNames]
    .sort((a, b) => a.localeCompare(b))
    .map((service) => {
      const serviceChecks = checks.filter((check) => check.service === service);
      const serviceFindings = findings.filter((finding) => finding.service === service);
      const highestSeverity =
        serviceFindings.reduce<Severity | null>((current, finding) => {
          if (current === null) {
            return finding.severity;
          }
          return SEVERITY_RANK[finding.severity] > SEVERITY_RANK[current]
            ? finding.severity
            : current;
        }, null) ?? null;

      return {
        service,
        checks: serviceChecks.length,
        findings: serviceFindings.length,
        highestSeverity,
      };
    });
}

export function evaluateSnapshot(
  snapshot: AuditSnapshot,
  options?: { suppressions?: string[] },
): AuditReport {
  const rawFindings = collectFindings(snapshot.checks);
  const findings = sortFindings(
    suppressFindings(rawFindings, options?.suppressions ?? []),
  );

  const totals = {
    checks: snapshot.checks.length,
    findings: findings.length,
    high: findings.filter((finding) => finding.severity === "high").length,
    medium: findings.filter((finding) => finding.severity === "medium").length,
    low: findings.filter((finding) => finding.severity === "low").length,
  };

  return {
    environment: snapshot.environment,
    capturedAt: snapshot.capturedAt,
    totals,
    services: summarizeServices(snapshot.checks, findings),
    findings,
  };
}
