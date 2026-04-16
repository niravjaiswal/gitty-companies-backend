import type { Finding } from "./types.js";

function findingKey(finding: Finding): string {
  return `${finding.service}:${finding.code}`;
}

export function suppressFindings(
  findings: Finding[],
  suppressions: string[],
): Finding[] {
  if (suppressions.length === 0) {
    return findings;
  }

  const blocked = new Set(
    suppressions.map((entry) => entry.trim()).filter(Boolean),
  );

  // TODO: support glob rules such as billing:* and *:ownership.
  return findings.filter((finding) => !blocked.has(findingKey(finding)));
}
