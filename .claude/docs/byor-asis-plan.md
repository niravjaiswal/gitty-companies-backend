# BYOR (Bring Your Own Repo) — As-Is Implementation Plan

Generated: 2026-04-19
Branch: main (to be branched for implementation)
Status: PLANNING

## Summary

Add a third assessment-workspace source: companies supply a public HTTPS git repo URL, the backend clones it, applies safety filtering, and stores the resulting file tree in the same `assessments.workspace_files` jsonb column the skeleton + remix path already uses. From the candidate session's perspective nothing changes — `sessionManager.ensureAssessmentWorkspaceGenerated` continues to read `workspace_files` and seed the sandbox.

This reuses every downstream component the remix path already built: the async `GenerationQueue` (polling / atomic claim / stale recovery), the `generation_status` state machine (`pending | processing | completed | failed`), `generation_error`, `chooseWorkspaceEntryFile`, `normalizeStoredWorkspace`, `SandboxService.seedAssessmentFiles`. The only net-new machinery is a repo-ingestion function and a `source_type` branch inside `GenerationQueue.processJob`.

## V1 cut (locked)

- **Public repos only.** HTTPS clone, no auth token. github.com / gitlab.com / bitbucket.org explicit host allowlist. Private repos, tokens, GitHub App installation are follow-ups.
- **Materialize at create-time.** Clone runs inside the `GenerationQueue` job; the file map is persisted to `workspace_files`. Session start path is unchanged. Tradeoff: cloned tree lives in Postgres jsonb — mitigated by hard size limits.
- **No AI rewriting, no anonymization, no structural edits.** We ingest what the company gave us. Anonymization is explicitly out of scope for v1.
- **Clone on the backend host, not in the sandbox.** Uses `node:child_process.execFile('git', ...)` into a unique temp dir under `os.tmpdir()`. No new npm dep, no Vercel sandbox spend per assessment, no dependency on sandbox availability for ingestion.
- **Reuse the existing queue.** `GenerationQueue.processJob` branches on `source_type`. No parallel queue.
- **Reject, don't silently repair.** If the repo is too large / has too many files / can't resolve an entry, the job goes to `failed` with a clear `generation_error`.

## Decisions locked in

| Decision | Choice | Why |
|---|---|---|
| Source of truth after clone | `workspace_files` jsonb (materialize) | Keeps session bootstrap path identical; immutable snapshot per assessment. |
| Cloning location | Backend host temp dir | Simpler, no sandbox cost, works if sandbox is down. |
| Git client | Raw `git` via `execFile` | Avoids adding `simple-git` dep; `git` binary is standard on host. |
| Clone depth | `--depth=1` + `--single-branch` | Small transfer, all content we need is HEAD. |
| Auth scope v1 | Public repos only | Smallest safe surface; credentials model is a follow-up. |
| Host allowlist | github.com, gitlab.com, bitbucket.org | Explicit allowlist keeps SSRF/abuse surface small. |
| Queue integration | Branch on `source_type` inside `GenerationQueue.processJob` | Reuses poll / claim / stale-recover / status transitions. |
| Entry-file selection | Reuse `chooseWorkspaceEntryFile` | Preference order (README, src/index.*, package.json) covers typical repos. |
| Post-clone validation | Reject, don't sanitize-and-continue | Candidate experience beats fuzzy outcomes. |
| Record commit SHA | Yes, `source_repo_commit_sha` | Traceability — company validated exactly what candidate sees. |
| PATCH semantics | Repo URL/ref change triggers re-ingestion (mirrors `regenerateWorkspace`) | Already the pattern. |

## Default limits

| Limit | Value | Reason |
|---|---|---|
| Total stored size (post-filter) | 5 MiB | `workspace_files` is jsonb in a Postgres row; keep row small. |
| File count (post-filter) | 2,000 | Protects sandbox seeding round-trip and DB row. |
| Max individual file | 1 MiB | Code is small; anything bigger is binary/generated. |
| Clone timeout | 60s | `execFile` timeout; network hangs fail fast. |
| Default ref | `main` | Server-resolved HEAD if caller omits ref. |

## Schema migration

`src/app/infra/db/migrations/010_assessment_source_repo.sql`:

```sql
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS source_type text
  CHECK (source_type IS NULL OR source_type IN ('skeleton', 'repo'));

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS source_repo_url text;

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS source_repo_ref text;

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS source_repo_commit_sha text;

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS source_repo_metadata jsonb;
```

## API changes

### POST `/api/company/assessments`

New optional fields: `sourceType`, `sourceRepoUrl`, `sourceRepoRef`.

Validation:
- If `sourceType === 'repo'`: `sourceRepoUrl` required, must parse as HTTPS URL on allowed host.
- URL host must be `github.com`, `gitlab.com`, or `bitbucket.org`.
- `sourceRepoRef` optional (default `main`); ref charset `/^[A-Za-z0-9._\-\/]+$/`.
- `sourceType: 'repo'` + `demoMode: true` → 400.
- Always queued; response is 202 with `generation_status: 'pending'`.

### PATCH `/api/company/assessments/:id`

Same fields; if any change, re-queue via `regenerateWorkspace` branch.

### GET response

Extends `serializeAssessment` with `sourceType`, `sourceRepoUrl`, `sourceRepoRef`, `sourceRepoCommitSha`, `sourceRepoMetadata`.

## Module changes

### New: `src/app/modules/assessments/repoIngestion.ts`

```ts
export interface RepoIngestLimits { ... }
export interface RepoIngestResult {
  files: Record<string, string>;
  entryFilePath: string;
  commitSha: string;
  metadata: { ... };
}
export class RepoIngestError extends Error {
  code: 'INVALID_URL' | 'DISALLOWED_HOST' | 'CLONE_FAILED' | 'CLONE_TIMEOUT'
      | 'REPO_TOO_LARGE' | 'TOO_MANY_FILES' | 'NO_FILES' | 'INTERNAL';
}
export function parseAndValidateRepoUrl(url: string): URL;
export async function ingestRepo(input): Promise<RepoIngestResult>;
```

Filter rules (applied in order):
1. Prefix strip: `.git/`, `node_modules/`, `dist/`, `build/`, `.next/`, `.turbo/`, `.cache/`, `coverage/`, `.vercel/`, `.svelte-kit/`.
2. Filename strip: `.env*`, `*.pem`, `*.key`, `id_rsa*`, `*.pfx`, `*.p12`, `.npmrc`, `.yarnrc`, `.DS_Store`, `Thumbs.db`.
3. Per-file > 1 MiB → drop as `too_large`.
4. Binary sniff: null byte in first 8 KB → drop as `binary`.
5. Path safety: run through `normalizeWorkspaceRelativePath`.

Always clean temp dir in `finally`.

### Changed: `src/app/modules/generation/generationQueue.ts`

Branch `processJob` on `source_type`:
- `'repo'` → `processRepoJob` (calls `ingestRepo`, writes workspace + metadata).
- `'skeleton'` or `null` (legacy) → existing remix flow.

Error code → user message mapping:
| Code | Message |
|---|---|
| INVALID_URL | "Repository URL is not a valid HTTPS URL." |
| DISALLOWED_HOST | "Only github.com, gitlab.com, and bitbucket.org repositories are supported." |
| CLONE_FAILED | "Could not clone the repository. Check that the URL is correct and the repo is public." |
| CLONE_TIMEOUT | "Clone timed out. The repository may be too large or the network was slow." |
| REPO_TOO_LARGE | "Repository exceeds the size limit after filtering." |
| TOO_MANY_FILES | "Repository has too many files after filtering." |
| NO_FILES | "Repository contained no text files we could import." |
| INTERNAL | "Internal error while importing the repository." |

### Changed: `src/app/modules/assessments/assessmentRoutes.ts`

- POST/PATCH schema: add `sourceType`, `sourceRepoUrl`, `sourceRepoRef`.
- `serializeAssessment`: expose new fields camelCased.
- POST: when `sourceType === 'repo'`, persist row, set `generation_status='pending'`, return 202.
- PATCH: changes to repo fields trigger re-ingestion.

### Unchanged

- `sessionManager.ts` — workspace read is source-agnostic.
- `sandbox.ts` — `seedAssessmentFiles` already handles arbitrary maps.
- `assessmentWorkspace.ts` — helpers reusable.

## Failure-mode matrix

| Scenario | Status | Message |
|---|---|---|
| URL not HTTPS | 400 create / `failed` queue | INVALID_URL |
| Host not allowed | 400 / `failed` | DISALLOWED_HOST |
| 404 / private / auth required | `failed` | CLONE_FAILED |
| Branch doesn't exist | `failed` | CLONE_FAILED |
| Network hang | `failed` | CLONE_TIMEOUT |
| Kept content > 5 MiB | `failed` | REPO_TOO_LARGE |
| > 2,000 files | `failed` | TOO_MANY_FILES |
| All files filtered | `failed` | NO_FILES |
| `.env*` found | silent strip | counted in metadata |
| Path traversal | silent drop | — |

## Test plan

### Unit — `repoIngestion.test.ts` (new)

1. URL validation accepts github/gitlab/bitbucket HTTPS; rejects http, ssh, file://, evil.com, malformed.
2. Happy path with mocked git + fixture dir — file map matches expected.
3. Size-limit breach → REPO_TOO_LARGE.
4. File-count limit → TOO_MANY_FILES.
5. Per-file size limit → drop specific file, count in metadata.
6. Binary filter → PNG-like content dropped.
7. `.env` strip → `.env`, `.env.local`, `config/.env.production` all dropped.
8. Path traversal → dropped.
9. All files filtered → NO_FILES.
10. `git clone` exit 128 → CLONE_FAILED.
11. Timeout → CLONE_TIMEOUT.
12. Cleanup in finally (spy `fs.rm`).

### Unit — `generationQueue.test.ts` (extend)

1. `source_type === 'repo'` + mocked `ingestRepo` success → writes workspace + commit sha, status `completed`.
2. `ingestRepo` throws REPO_TOO_LARGE → `failed` with mapped message.
3. `source_type === 'skeleton'` runs remix path (regression).
4. `source_type == null` treated as `'skeleton'`.

### Manual smoke

- Small public React repo.
- Small Express repo.
- Large repo (> 5 MiB source) → `failed`.
- Repo with committed `.env` → dropped, counted.

## Milestones

| # | Milestone | Status | Depends on |
|---|---|---|---|
| B0 | Migration 010 | Pending | — |
| B1 | `repoIngestion.ts` + unit tests | Pending | B0 |
| B2 | Route POST/PATCH + serialize | Pending | B0 |
| B3 | Queue dispatch on `source_type` | Pending | B1, B2 |
| B4 | Manual smoke on staging | Pending | B3 |
| B5 | Docs + error-copy review | Pending | B4 |

## Anti-goals

- No anonymization.
- No AI rewriting.
- No private-repo support in v1.
- No cloning inside the Vercel sandbox.
- No streaming / partial ingestion.
- No parallel `RepoIngestionQueue` class.
- No backfill of `source_type` on legacy rows.

## Notes

- Confirm `git` is on the backend host image (Dockerfile if applicable).
- Node 20+ required for `readdir({ recursive: true })`.
- Confirm `@supabase/supabase-js` handles a 5 MiB `workspace_files` roundtrip; if not, lower `maxStoredBytes`.
