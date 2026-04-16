export type CheckStatus = "pass" | "warn" | "fail";

export type Severity = "low" | "medium" | "high";

export interface AuditCheck {
  service: string;
  code: string;
  status: CheckStatus;
  message: string;
  owner?: string;
  durationMs?: number;
  budgetMs?: number;
}

export interface AuditSnapshot {
  environment: string;
  capturedAt: string;
  checks: AuditCheck[];
}

export interface Finding {
  service: string;
  code: string;
  severity: Severity;
  message: string;
  evidence: string[];
}

export interface ServiceSummary {
  service: string;
  checks: number;
  findings: number;
  highestSeverity: Severity | null;
}

export interface AuditReportTotals {
  checks: number;
  findings: number;
  high: number;
  medium: number;
  low: number;
}

export interface AuditReport {
  environment: string;
  capturedAt: string;
  totals: AuditReportTotals;
  services: ServiceSummary[];
  findings: Finding[];
}
