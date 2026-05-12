# Pipeline Insights Console

A TypeScript data-processing assessment focused on batch aggregation, object-mode stream processing, and CLI reporting over telemetry events.

## Getting started

```bash
npm install
npm run dev
npm run test
```

## Overview

This workspace models a small telemetry analysis tool for a data platform. The codebase includes:

- a shared event model (`src/types.ts`)
- a batch summarizer (`src/batch.ts`) — full-window aggregation
- an object-mode stream transform (`src/stream.ts`) — fixed time windows
- a deterministic CLI report (`src/cli.ts`) over bundled sample data
- the reporting layer (`src/report.ts`) that fuses both inputs

## The architectural tension

Two layers compute over the same events with different time semantics:

| Layer | What it sees | When severity is decided |
|-------|--------------|--------------------------|
| `batch.ts` (`summarizeBatch`) | the whole event set | post-hoc, after every event has arrived |
| `stream.ts` (`collectWindowInsights`) | one fixed window at a time | as each window closes, no retroactive update |

These disagree on **late-arriving events**. A late event lands inside a window after that window has already been classified — `batch.ts` will count it; `stream.ts` will not retroactively re-classify the window it belongs to. `report.ts` (`buildPipelineReport`) joins both views into one structure but does not reconcile this disagreement.

Two boundary issues arise from this:

1. **Threshold sensitivity.** `isLateEvent` in `batch.ts` uses a `10 * 60 * 1000` ms threshold. Events near that boundary flip late/on-time classification with sub-minute timestamp shifts. The test fixtures contain events tuned around this boundary (read `data.ts` carefully).
2. **Severity drift.** A window classified as `green` by the stream layer may contain events that the batch layer considers failures or late. The headline string and per-window severity can disagree on the same event set.

## Your task

Extend the reporting layer in `src/report.ts` so the report output remains internally consistent under late events and threshold-sensitive cases.

There is more than one valid approach. Pick one and apply it consistently:

- **Stream-authoritative**: the per-window severity is the source of truth; the headline reflects what stream-time observers actually saw.
- **Batch-authoritative**: the post-hoc batch view overrides per-window severities so the report represents the steady state.
- **Annotated**: keep both views and surface the disagreement explicitly (e.g., "window X classified `green` at close, reclassified `amber` after late arrivals").

The candidate's job is not to invent a new algorithm — both layers already work correctly under their own semantics. The judgment call is **which semantic the report contract guarantees**, and whether late-event reconciliation is the responsibility of `report.ts` or its callers.

## What to look for

- a single, defensible reconciliation policy applied uniformly across the headline, the breakdown, and the windows
- explicit handling of zero-duration / zero-record events (do they count toward `averageDurationMs`?)
- deterministic output suitable for a terminal — order of windows, ties in severity, and pipeline ordering must all be stable
- tests that pin the chosen policy without coupling to fixture-specific event IDs

## Test contract

The existing tests in `src/__tests__/report.test.ts` pin a minimal contract: total event count, window count, headline shape. Do not weaken them. Any reconciliation policy you adopt must continue to satisfy these. The contract intentionally does not pin which policy wins — that is the candidate's choice to defend.

## Submission

- Keep `npm run build` and `npm test` green.
- Document the policy you chose in a short comment at the top of `report.ts`.
- Do not modify `batch.ts` or `stream.ts` — those are the inputs you reconcile, not the surface under change.
