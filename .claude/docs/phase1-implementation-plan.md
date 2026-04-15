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
       |  M5: Skeleton library    |  PENDING
       |  (#2-#5 in order)        |
       |  M6: Repair loop         |  PENDING
       +--------------+-----------+
                      v
       +--------------------------+
       |  M7: Web app integration |  PENDING
       |  (job API + Monaco UI +  |
       |   publish flow)          |
       +--------------+-----------+
                      v
       +--------------------------+
       |  M8: Customer validation |  PENDING
       +--------------------------+
```

## Skeleton priority order

| # | Skeleton | Type | Status |
|---|---|---|---|
| 0 | Pulseboard (React+Vite) | Frontend | Done — 11 adaptable files |
| 1 | REST API (Express) | Backend | Done — 3 adaptable files |
| 2 | React frontend (state mgmt) | Frontend | Pending |
| 3 | Data processing | Data eng | Pending |
| 4 | CLI tool | Systems | Pending |
| 5 | Full-stack (API + React) | Generalist | Pending |

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

### M5 — Skeleton library expansion (PENDING)

Build skeletons #2-#5 in priority order.

Each skeleton: working project, tests, manifest with provided/candidate roles, validated against contract.

Priority:
1. React frontend (state mgmt) — ~1-2 days
2. Data processing (stream/batch) — ~1-2 days
3. CLI tool — ~1 day
4. Full-stack (API + React) — ~2-3 days

### M6 — Validation + repair loop polish (PENDING)

The repair loop already works (used in M3 spike). Polish items:
- Tune repair prompts for higher first-pass success
- Add metrics/logging for repair rounds in production
- Consider 2-pass repair for agent path failures

### M7 — Web app integration (PENDING)

Wire everything into the frontend.

Deliverables:
- Skeleton picker in assessment creation form
- Role brief textarea + "Generate" button
- Job progress UI (poll every 3s, show generationStatus)
- On completion: open in existing Monaco editor for review/edit
- "Publish" button to finalize and create candidate session

### M8 — Customer validation (PENDING)

Hand URL to hiring managers. Watch them use it. Measure against success criteria from design doc.

## Parallelization strategy

After M4, three independent lanes:

| Lane | Steps | Modules touched | Dependencies |
|------|-------|----------------|-------------|
| A | M5 (skeleton library) | backend/src/skeletons/ | M0 format |
| B | M6 (repair loop) | backend/src/remix/ | M2 engine |
| C | M7 (web integration) | frontend + backend routes | M4 queue |

M7 can start now that M4 is done. M5 and M6 are independent of each other and of M7.

## What already exists (reusable)

- `src/skeletons/` — 2 proven skeletons with loader, validation, contract
- `src/remix/` — full agent adaptation pipeline, 100% fidelity
- `src/validation/` — RepoExecutor, tsc/vitest parsing, repair functions
- `src/app/modules/generation/generationQueue.ts` — async job processing
- Monaco editor + xterm.js in frontend — workspace review/edit UI already exists
