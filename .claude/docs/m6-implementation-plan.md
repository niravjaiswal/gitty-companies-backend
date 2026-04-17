# M6 Implementation Plan — Validation + Repair Loop Polish

Generated: 2026-04-17
Branch: main (to be branched for implementation)
Status: PLANNING

## Strategic framing

The current pipeline has four weaknesses I want to close:

1. **Fails open.** `generationQueue.processJob` marks jobs `completed` and persists `workspace_files` even when the post-agent verification gate failed. Broken workspaces can reach candidates.
2. **Errors are thrown away.** `agent-adapt.ts` truncates tsc/vitest stderr to 300 chars of log output and `remix.ts` flattens it to `"Post-agent verification failed"`. No way to diagnose failures in production.
3. **No second shot.** First-pass agent has 45 turns / $1.50. If it exhausts those without passing, we ship whatever state the workspace is in. A fresh agent with error context in hand is a qualitatively different attempt (clean context window, narrow scope) — not just redundancy.
4. **No evidence for prompt tuning.** Four skeletons (`data-pipeline-insights`, `fullstack-support-hub`, `ops-cli-audit`, `react-orders-board`) have never been spike-tested end-to-end through remix. We don't know their baseline fidelity. The existing system prompt probably has gaps specific to their shapes.

Item 1 is a correctness bug. Items 2-4 are all "we can't see what's happening" problems. M6 closes all four.

## Judgment calls (flagging explicitly, since I got this wrong once)

| Decision | Choice | Alternative considered | Why |
|---|---|---|---|
| 2-pass repair | Yes, ship it | Wait for production data | Fresh-context repair is a real mechanism, not speculative. 4 skeletons are untested. Cost only fires on failure. |
| Prompt tuning | Yes, from a mini-spike of new skeletons | Skip until production traces arrive | M3 spike was data; running 2 remixes × 4 skeletons = 8 runs = ~$4 is cheap evidence. |
| Metrics storage | JSONB column on `assessments` | Separate `generation_runs` table | Low volume, easy migration, queryable in Supabase UI. Upgradeable later. |
| Repair budget | 20 turns / $0.50 | Same as first pass (45 / $1.50) | Repair is narrower in scope — should need less. Cap prevents unbounded cost on pathological cases. |
| Repair instead of retry-from-scratch | Repair in place | Throw away workspace, start fresh | Agent's first-pass edits are usually mostly right; repairing saves 90% of the work. Fresh context comes from a new SDK session, not a new workspace. |
| Fail-closed location | Queue decides | Remix throws on failure | `remix()` honestly returns what happened; queue owns the "what do we do about it" policy. |

## Out of scope (defer to later milestones)

- OpenTelemetry / external metrics (M6 is DB-column-level observability).
- Per-customer cost budgets / rate limits.
- Circuit breakers on repair failure rate.
- A separate `generation_runs` audit table.
- Three-or-more repair passes.
- Clearing stale `workspace_files` from prior successful generations on regeneration failure (flagged, not fixed).

## Dependency map

```
     Step 1: error surfacing (agent-adapt return shape)
                     |
          +----------+----------+
          v                     v
     Step 2: 2-pass        Step 4: metrics
     repair (remix.ts)     column + population
          |                     |
          +----------+----------+
                     v
          Step 3: fail-closed in queue
                     v
          Step 5: spike + prompt tune
```

Steps 1 → 2 → 3 are sequential (each depends on prior shape). Step 4 can overlap with 2. Step 5 is verification/data-gathering that runs after everything else merges and informs any prompt PR.

## Step-by-step

### Step 1 — Widen error surfacing

**Files:** `src/remix/agent-adapt.ts`, `src/remix/types.ts`, `src/remix/remix.ts`.

**Shape:**
- Extend `AgentAdaptResult` with:
  ```ts
  tscOutput: string;     // full stdout+stderr, capped at 5KB
  vitestOutput: string;  // full stdout+stderr, capped at 5KB
  ```
- Cap at 5KB each (10KB total) so DB writes stay bounded. Front-truncate; errors usually cluster at the top of tsc output.
- `remix.ts`: when `verified === false`, populate `validation.errors` with the real tsc/vitest output instead of the stub string. Keep `overallPass` boolean as-is (no schema break for downstream).

**Test:** unit test a helper `truncateOutput(s: string, max: number): string` that preserves the head and marks truncation. Unit-testable in isolation.

**Risk:** low — additive returns, no behavior change.

### Step 2 — 2-pass repair

**Files:** new `src/remix/agent-repair.ts`, `src/remix/agent-prompts.ts` (+ two new builders), `src/remix/remix.ts`, `src/remix/types.ts`.

**Behavior:**
- Triggered only when first-pass `agentAdapt` returns `verified: false`.
- Reuses the existing `RepoExecutor` (same temp dir, same `node_modules`, first-pass edits preserved).
- Spawns a new `query()` session with:
  - Fresh context window.
  - Narrow system prompt: "the previous agent already themed this workspace for the target company. Your job is to fix these specific tsc/vitest failures without introducing new features or re-theming."
  - User prompt includes the tsc output, vitest output, and manifest — NOT the full file contents. The agent reads files it needs.
  - Tools: `Read`, `Edit`, `Bash`, `Grep`, `Glob` (drop `Write` — repair shouldn't create files).
  - Budget: 20 turns, $0.50.
- After repair agent exits, re-run the post-agent gate. Final `verified` is post-repair state.
- Re-read metadata after repair (the agent might have regenerated `_remix_metadata.json` after fixing a test; should be rare but safe).

**Types:**
- Extend `AgentUsage` to a repeatable shape, or add a new `AdaptMetrics` type:
  ```ts
  type AdaptMetrics = {
    primaryPass: AgentUsage & { verified: boolean };
    repairPass: (AgentUsage & { verified: boolean }) | null;
  };
  ```
- `RemixResult.usage.adapt` becomes `AdaptMetrics` (type break — need to update `smoke-test.ts`).

**Test strategy:**
- Unit test that when first-pass returns `verified: true`, no repair is called.
- Unit test that repair-pass usage is `null` on first-pass success.
- Hard to unit-test the actual repair agent without the SDK. Acceptance: smoke-test script exercises it end-to-end.

**Risk:** medium — new agent session, new prompt, new budget. Mitigation: the trigger is gated on first-pass failure, which is 0% in M3 — no impact unless repair is needed.

### Step 3 — Fail-closed in queue

**Files:** `src/app/modules/generation/generationQueue.ts`, tests.

**Change:** in `processJob` after `remix()` returns, branch on `result.validation.overallPass`:
- **Pass:** current behavior (write `workspace_files`, mark `completed`).
- **Fail:** do NOT write `workspace_files`. Mark `generation_status: 'failed'` with `generation_error` set to truncated errors (fit in the 2000-char cap already used at line 184).

**Test:** add to `generationQueue.test.ts` — a unit test with a fake remix result that returns `overallPass: false`. Mock Supabase updates, assert the write shape. (The existing tests only cover `chooseSkeleton` — worth building a tiny mock harness here.)

**Risk:** low — single if-branch, defensive.

### Step 4 — Metrics column

**Files:** new `src/app/infra/db/migrations/009_generation_metrics.sql`, `src/app/modules/generation/generationQueue.ts`.

**Migration:**
```sql
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS generation_metrics jsonb;
```

**Shape written by queue on completion (success or failure):**
```json
{
  "skeleton_id": "rest-api-express",
  "primary": {
    "turns": 23,
    "cost_usd": 0.487,
    "duration_ms": 94000,
    "input_tokens": 34000,
    "output_tokens": 2100,
    "verified": true
  },
  "repair": null,
  "final_verified": true,
  "tsc_output_head": "(empty on success, first 500 chars on fail)",
  "vitest_output_head": "(ditto)"
}
```

When repair fires, `repair` is the same shape as `primary`.

**Risk:** low. Additive column, defensive nullable writes.

### Step 5 — Spike + prompt tune

**Run:** `npx tsx src/remix/smoke-test.ts <skeleton-id>` twice for each of:
- `data-pipeline-insights`
- `fullstack-support-hub`
- `ops-cli-audit`
- `react-orders-board`

That's 8 runs, ~$4. Capture output to `.claude/docs/m6-spike-results.md` (gitignored or committed — ask).

**Interpret:**
- If all 8 pass first-pass → current prompt is fine; document as baseline.
- If any fail first-pass but pass repair → repair is proven; no prompt change strictly required, but look at what the repair agent fixed and consider preempting.
- If anything fails repair too → prompt tune mandatory; figure out the pattern.

**Prompt tune rule:** only add a system-prompt rule when there's concrete evidence (≥1 observed failure + plausible generalization). Don't speculate.

## Testing plan

| Level | What | Where |
|---|---|---|
| Unit | `truncateOutput` helper | `src/remix/__tests__/agent-adapt.test.ts` (new) |
| Unit | Queue fail-closed branching with fake remix results | `src/app/modules/generation/__tests__/generationQueue.test.ts` (extend) |
| Unit | Metrics shape validation | same file |
| Integration | `library.test.ts` still green for all 6 skeletons | existing, unchanged |
| Manual | Smoke-test spike (Step 5) | `smoke-test.ts` runs |

`npm test` before merging. No new test infrastructure needed.

## Migration / rollout

- Ship steps 1-4 as a single PR. They're tightly coupled (types flow through).
- Run migration 009 in Supabase.
- Merge, observe a few real jobs, review `generation_metrics` rows.
- Do step 5 as a separate PR if prompt changes land.

## Success criteria

1. If the agent produces a workspace that fails tsc or vitest, the candidate never sees it — `generation_status` is `failed` with readable error text.
2. `generation_metrics` populated for every new job (pass or fail).
3. Spike run on 4 new skeletons produces data. ≥50% first-pass or ≥75% including repair is a green signal; lower triggers prompt work.
4. No regression: existing `library.test.ts` and `generationQueue.test.ts` still pass.

## What to verify during implementation

- That the Agent SDK's `query()` accepts a second call on the same `cwd` without issue (it should; the SDK is stateless across calls).
- That `resultMessage` shape is stable enough to reuse — it currently lives inline in `agent-adapt.ts`; extract to a small helper.
- That Supabase's `jsonb` column doesn't need a migration for reads — the client returns it as an object.

## Anti-goals (do NOT do these)

- Don't add a third repair pass.
- Don't change the first-pass agent's budget (45 turns / $1.50 is proven).
- Don't re-order the queue's poll/claim logic — it works.
- Don't backfill `generation_metrics` on old rows — NULL is fine.
- Don't create `generation_runs` as a separate table.
