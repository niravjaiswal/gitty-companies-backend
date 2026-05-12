# Ops CLI Audit

A TypeScript CLI for reviewing an operational snapshot before a release.

## Getting started

```bash
npm install
npm run dev -- --input <path-to-snapshot.json>
npm test
```

## Overview

The CLI reads a JSON snapshot, converts failing checks into findings, and prints either a text or JSON report. Two suppression sources can suppress noisy findings:

- **In-code rules**: passed via `--ignore service:code,...`. Origin: the operator running the command.
- **Policy file**: passed via `--policy <path-to-policy.json>`. Origin: a release-engineering-managed config file (see `config/suppressions.json` for a sample).

Both sources are flat lists of `service:code` strings today (no globs, no rule expressions). They overlap deliberately — a real release-engineering team will encode org-wide policy in the file, while individual operators may want temporary in-code overrides.

## Architecture

```
src/
  cli.ts              CLI parsing + dispatch
  audit.ts            findings, severities, service summaries
  filter.ts           suppressFindings(...) — applies the merged suppression list
  report.ts           text + JSON formatting
  data.ts             bundled sample snapshot
  types.ts            shared domain types
  lib/
    policy.ts         policy file parser + merge strategies
    __tests__/policy.test.ts
  __tests__/
    audit.test.ts
    cli.test.ts
config/
  suppressions.json   Sample policy file (NOT loaded by default)
```

## The merge problem

When both `--ignore` and `--policy` are provided, the two suppression lists must be merged into one. Three policies are valid; the CLI exposes them via `--strategy`:

| Strategy | Behavior |
|----------|----------|
| `union` (default) | Both sources are honored; deduplicated. Any rule from either source suppresses. |
| `config-wins` | If the policy file has any entries, in-code rules are discarded. Use when central policy must not be undermined by ad-hoc overrides. |
| `in-code-wins` | If `--ignore` has any entries, file rules are discarded. Use for incident response. |

Note: this is **flat-list precedence**, not pattern precedence. The current suppression matcher only does exact `service:code` matches.

## Your task

The audit engine works. Two things are missing:

### 1. Glob-style suppressions

`src/filter.ts` only supports exact `service:code` matches. Update `suppressFindings` so suppression strings can be globs:

- `billing:*` — all codes for billing
- `*:ownership` — all services with the `ownership` code
- `search:latency-*` — codes starting with `latency-`

The merged suppression list (from `--ignore` and `--policy`) feeds into the same matcher. Globs apply uniformly regardless of which source contributed the rule.

### 2. Hierarchical merge (optional, harder)

Today `mergeSuppressions` (in `src/lib/policy.ts`) implements three flat strategies. Add a fourth — `hierarchical-match` — where:

- Specific rules (no `*`) override broader rules from the other source.
- Within each source, broader rules apply only when no specific rule from the other source already matches the finding.

This forces a judgment call: where does this logic live? Options include:

- inside `mergeSuppressions` (it must understand globs and inspect findings, which couples the merger to the matcher)
- inside `suppressFindings` (it accepts both lists separately and decides per-finding which wins)
- in a new dispatcher between `cli.ts` and `audit.ts`

Pick a placement, justify it in a short comment at the top of the chosen file, and add tests in `src/lib/__tests__/policy.test.ts` (or wherever the logic lives) that distinguish your placement from the alternatives.

You can ship task 1 alone for a passing submission; task 2 demonstrates judgment.

## Test contract

- `src/__tests__/audit.test.ts` — pins the existing audit engine and exact-match suppression
- `src/__tests__/cli.test.ts` — pins CLI flags including `--ignore`
- `src/lib/__tests__/policy.test.ts` — pins the policy parser, error handling, and merge strategies

Do not weaken these. Add tests as you implement.

## Submission

- Keep `npm run build` and `npm test` green.
- Document the placement decision for hierarchical merge if you implement it.
- Do not modify the snapshot parser or the report formatter — those are the inputs and outputs to the suppression layer, not the surface under change.
