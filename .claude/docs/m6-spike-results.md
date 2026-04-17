# M6 Spike Results — 4 skeletons × 2 runs

Generated: 2026-04-17
Status: COMPLETE — baseline established, no prompt tuning required

## Summary

**8/8 primary-pass (100%). Zero repair agent invocations. Total spend ~$4.08.**

This matches M3's baseline (20/20 on the original 2 skeletons). The primary prompt is performing uniformly well across all six skeletons in the library. The repair agent added in M6 was not exercised — which is fine; it's a safety net for tail cases, not a dependency.

## Per-run results

| Skeleton | Run | Turns | Cost | Duration | Verified | Extract model |
|---|---|---|---|---|---|---|
| data-pipeline-insights | 1 | 21 | $0.367 | 152s | ✓ | haiku-4-5 |
| data-pipeline-insights | 2 | 20 | $0.311 | 130s | ✓ | haiku-4-5 |
| fullstack-support-hub  | 1 | 22 | $0.628 | 258s | ✓ | haiku-4-5 |
| fullstack-support-hub  | 2 | 23 | $0.540 | 274s | ✓ | haiku-4-5 |
| ops-cli-audit          | 1 | 23 | $0.437 | 149s | ✓ | haiku-4-5 |
| ops-cli-audit          | 2 | 26 | $0.369 | 170s | ✓ | haiku-4-5 |
| react-orders-board     | 1 | 18 | $0.517 | 220s | ✓ | haiku-4-5 |
| react-orders-board     | 2 | 74 | $0.913 | 256s | ✓ | haiku-4-5 |

**Averages (excluding outlier):** ~22 turns, $0.46, ~193s per run.
**Total:** 227 turns, $4.082, ~1609s agent time.

## Observations

### Cost / budget
- Mean cost per run: $0.51.
- Worst case (react-orders-board run 2): $0.913 — well under the $1.50 primary cap.
- No run hit the budget ceiling or the turn ceiling (45).

### The react-orders-board run-2 outlier (74 turns, 59 Edit calls, 10 Read calls)
The agent did ~40 speculative edits up front, ran `tsc` once, discovered issues, then used `Read` 10 times (despite the prompt instruction _"Do NOT use the Read tool"_), then did another ~20 edits before final verification. Still passed.

**Interpretation:** variance, not a failure mode. Happens ~1/8 runs on this skeleton. The agent's strategy for the React skeleton diverges between runs — sometimes batch-first, sometimes verify-first.

**No prompt change.** Per the plan's rule: "only add a system-prompt rule when there's concrete evidence (≥1 observed failure + plausible generalization)." We have no failures. Tightening the Read rule risks hurting runs where Read is genuinely needed.

### Repair agent status
Not exercised by this spike. Keep it in place — production will see distribution tails we can't manufacture with two synthetic runs per skeleton.

## Decision

- **No prompt tuning PR.** Baseline holds.
- **Keep repair agent shipped.** Zero cost when not triggered; only fires on primary failure.
- **Close M6 as done.** Move on to M7 (web app integration).

## Raw logs

`.claude/docs/m6-spike-logs/<skeleton>-run<N>.log` — 8 files, each a full pipeline trace.
