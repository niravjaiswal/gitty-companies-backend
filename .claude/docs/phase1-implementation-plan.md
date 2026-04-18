# Phase 1 Implementation Plan — Assessment Remix System

Generated: 2026-04-07
Updated: 2026-04-14
Branch: main
Repo: gitty-companies
Status: APPROVED — M0-M4 complete

## Strategic principle

Build in order of risk, not order of delivery. The fidelity spike (M3) is the entire bet. Run it first on the cheapest possible substrate before writing a single new skeleton.

## Decisions locked in

- **Job queue**: In-process polling queue using Supabase REST client. ~~pg-boss~~ was dropped — no direct Postgres connection exists in the codebase, and pg-boss requires LISTEN/NOTIFY which conflicts with Supabase's pgBouncer pooler. Upgradeable to pg-boss later if scale demands it.
- **Skeleton priority**: Coverage/de-risking over momentum. REST API before more React.
- **Spike threshold**: 80% both-pass (tsc + vitest) as go/no-go gate.
- **Patch format**: Full-file replacement (not diffs). Simpler, avoids merge conflicts.
- **Adaptation engine**: Agent SDK (claude-sonnet-4-6) via `@anthropic-ai/claude-agent-sdk`. The agent edits files in-place and runs tsc/vitest to self-verify. Legacy single-shot adapt path still exists but agent path is the default.
- **Fallback**: If spike fails at 60-79%, tighten prompt + harden manifest. If <60%, two-pass adaptation.

## Milestone status

| Milestone | Status | Shipped | Notes |
|-----------|--------|---------|-------|
| M0: Skeleton format | Done | PR #3 | Zod schemas, manifest, contract docs |
| M1: Extract demo to skeleton | Done | PR #3 | pulseboard-launch-sprint + rest-api-express |
| M2: Remix engine | Done | PR #3 | Agent + legacy paths, validation, repair |
| M3: Fidelity spike | Done | PR #3 | 20/20 (100%) — pulseboard 10/10, rest-api 10/10 |
| M4: Async generation queue | Done | pending | In-process polling queue, not pg-boss |
| M5: Skeleton library expansion | Pending | — | |
| M6: Repair loop polish | Pending | — | |
| M7: Web app integration | Pending | — | |
| M8: Customer validation | Pending | — | |

## Dependency map

```
                    +--------------------------------------+
                    |  M0: Skeleton format definition       |  DONE
                    |  (schema + manifest + contract docs)  |
                    +-----------------+--------------------+
                                      |
                 +--------------------+--------------------+
                 v                                         v
   +-------------------------+          +-------------------------+
   |  M1: Extract demo        |  DONE   |  M2: Remix engine v0    |  DONE
   |  demoWorkspace.ts        |          |  (Agent SDK + legacy    |
   |  -> skeleton #0 + #1     |          |   adaptation + repair)  |
   +------------+-------------+          +------------+------------+
                |                                     |
                +------------------+------------------+
                                   v
                  +-------------------------------+
                  |  M3: FIDELITY SPIKE            |  DONE — 20/20 (100%)
                  |  20 remixes across 2 skeletons |
                  |  pulseboard: 10/10, $0.574 avg |
                  |  rest-api: 10/10, $0.348 avg   |
                  +---------------+---------------+
                                  |
                  +---------------+---------------+
                  |   PASS (100%)                  |
                  +--------------------------------+
                          |
       +--------------------------+
       |  M4: Async job queue     |  DONE
       |  (in-process polling,    |
       |   Supabase REST client)  |
       |  M5: Skeleton library    |  DONE (6 skeletons)
       |  M6: Repair loop         |  DONE (2-pass repair)
       +--------------+-----------+
                      v
       +--------------------------+
       |  M7: Web app integration |  DONE
       |  (skeleton picker +      |
       |   generation poll page)  |
       +--------------+-----------+
                      v
       +--------------------------+
       |  M8: Customer validation |  PENDING
       +--------------------------+
```

## Skeleton priority order

| # | Skeleton | Type | Status |
|---|---|---|---|
| 0 | `pulseboard-launch-sprint` (React+Vite) | Frontend | Done |
| 1 | `rest-api-express` | Backend | Done |
| 2 | `react-orders-board` | Frontend (data-heavy) | Done |
| 3 | `data-pipeline-insights` | Data eng | Done |
| 4 | `ops-cli-audit` | Systems (CLI) | Done |
| 5 | `fullstack-support-hub` | Generalist | Done |

## Milestones (detail)

### M0-M3 — Complete (shipped in PR #3)

See git history on main. Key files:
- `src/skeletons/` — format definition, loader, two skeletons
- `src/remix/` — agent adaptation, legacy adaptation, validation, repair
- `src/validation/` — RepoExecutor, tsc/vitest parsing, repair functions

### M4 — Async generation queue (DONE)

**Architecture change:** Replaced pg-boss with a simple in-process polling queue.

**Why:** The entire codebase uses Supabase REST client (`@supabase/supabase-js`). There is no direct Postgres connection anywhere. pg-boss requires a direct connection + LISTEN/NOTIFY, which (a) introduces a second DB access pattern, (b) may conflict with Supabase's pgBouncer pooler in transaction mode, and (c) is overkill for single-digit jobs/day. The polling queue provides the same reliability guarantees (atomic claims via WHERE clause, stale job recovery) with zero new dependencies.

**Deliverables:**
- Migration `008_generation_queue.sql` — adds `skeleton_id`, `generation_status`, `generation_error`, `generation_started_at`, `generation_completed_at` to assessments table. Partial index on pending jobs.
- `GenerationQueue` class (`src/app/modules/generation/generationQueue.ts`) — 5s poll interval, atomic claim, stale recovery (10min threshold), graceful shutdown. Runs remix pipeline with `useAgent: true`.
- Route changes — POST returns 202 for non-demo generation (queued). PATCH queues regeneration. Generation status fields included in all assessment responses. `skeletonId` added to API schema.
- SessionManager — no longer falls back to synchronous generation. Checks `generation_status` and throws descriptive errors.
- AssessmentWorkspaceService — `generate()` now demo-only. Old 4-stage pipeline imports removed.
- Server lifecycle — queue starts after listen, stops on shutdown.
- Skeleton auto-selection — keyword heuristic on source_brief (frontend keywords → pulseboard, default → rest-api).

### M5 — Skeleton library expansion (DONE)

Six skeletons shipped, covering the full priority list plus extras:
- `rest-api-express` — REST API baseline
- `pulseboard-launch-sprint` — React frontend (state mgmt)
- `react-orders-board` — React frontend (data-heavy)
- `data-pipeline-insights` — data processing
- `ops-cli-audit` — CLI tool
- `fullstack-support-hub` — full-stack (API + React)

### M6 — Validation + repair loop polish (DONE)

2-pass repair agent shipped with per-job metrics and fail-closed gate. M6 spike: 8/8 primary pass on baseline runs.

### M7 — Web app integration (DONE)

Shipped:
- `GET /api/company/skeletons` endpoint + skeleton picker in CreateAssessment (live mode only)
- `/dashboard/assessments/:id/generation` progress page with 3s polling, long-run warning, regenerate CTA
- AssessmentEditor redirects to generation page when status is pending/processing/failed with no files
- 202 Accepted contract consumed end-to-end; demo flow preserved

### M8 — Customer validation (PENDING)

Hand URL to hiring managers. Watch them use it. Measure against success criteria from design doc.

## Parallelization strategy

After M4, three independent lanes:

| Lane | Steps | Modules touched | Dependencies |
|------|-------|----------------|-------------|
| A | M5 (skeleton library) | backend/src/skeletons/ | M0 format |
| B | M6 (repair loop) | backend/src/remix/ | M2 engine |
| C | M7 (web integration) | frontend + backend routes | M4 queue |

All three lanes complete. Only M8 remains.

## What already exists (reusable)

- `src/skeletons/` — 6 proven skeletons with loader, validation, contract
- `src/remix/` — full agent adaptation pipeline, 100% fidelity
- `src/validation/` — RepoExecutor, tsc/vitest parsing, repair functions
- `src/app/modules/generation/generationQueue.ts` — async job processing
- Monaco editor + xterm.js in frontend — workspace review/edit UI already exists
