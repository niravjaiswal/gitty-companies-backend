# Northstar Orders Board

## Overview

You are stepping into Northstar Commerce, where dispatch and operations teams track same-day fulfillment on a live React board.

The repo is already scaffolded as a normal React + TypeScript + Vite app. The reducer in `src/state/orders.ts` runs the board; `App.tsx` wires it to the UI. Your job is not to write the reducer from scratch — it is to make a **policy decision** about how the reducer should behave under three subtle conflicts that the existing tests partially expose.

## The architectural tension — three policy decisions

The reducer composes three independent concerns: filtering, search, and a separate sort that pins urgent orders. These compose cleanly in the happy path. They do not compose cleanly under these three conditions:

### 1. Selection survival under filter change

When the active filter excludes the currently selected order, three policies are valid:

- **Keep selection (stale)**: `selectedOrderId` stays even if the corresponding order is filtered out. The details panel renders the stale order; counts move on.
- **Clear selection**: setting a filter that hides the selected order resets `selectedOrderId` to `null`.
- **Auto-pick**: selection follows the visible list — when the current selection becomes invisible, snap to the first visible order.

The current reducer takes one of these implicitly. Decide explicitly which one is the contract, document it, and apply it consistently across `filter_changed`, `query_changed`, `priority_toggled`, and `status_advanced`.

### 2. New-order ordering under an active urgent filter

When a candidate creates a new order via the composer with `priority: 'standard'` while the filter is `'urgent'`, the new order is invisible immediately after creation despite `selectedOrderId` pointing to it. Decide whether `draft_submitted` should:

- always insert and let the filter hide the result (current behavior),
- bypass the filter for the freshly created order (snap filter back to `'all'`),
- or refuse to submit when the filter would hide the result.

### 3. Status-advance through the terminal state

`advanceStatus` clamps at the last entry in `statusFlow` (`shipped`). Repeated `status_advanced` actions on a shipped order are silent no-ops. Decide whether this is the contract or whether the action should be guarded earlier (no-op explicitly, or surface an error analogous to `validateDraft`).

## Your task

1. Read `src/state/orders.ts` carefully. The reducer compiles and the current tests pass — the gaps are policy gaps, not implementation gaps.
2. Pick one policy for each of the three conflicts above. Justify each in a brief comment in `orders.ts`.
3. Tighten the reducer and add at least one test in `src/state/orders.test.ts` per conflict pinning your chosen policy.
4. Make sure `src/App.test.tsx` still passes — UI assumptions baked into App-level tests must hold under your new policies.

## Candidate workflow

- Explore the codebase and understand how state flows through the board.
- Run the app locally in the sandbox.
- Run the tests to verify current behavior.
- Implement the missing state logic and leave the tests passing.
- Submit the assessment when you are done.

## Sandbox commands

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 3000
npm run test
```

## Product context

- The left rail summarizes queue health and order pressure.
- The board shows active orders grouped by status.
- The details panel lets dispatchers advance a selected order.
- The composer is intentionally central to the assessment and touches the reducer.
- The interface should feel like a real internal tool, not a toy demo.

## What we're evaluating

- **Policy clarity**: each of the three decisions documented and applied uniformly.
- **Test coverage of policy edges**: assertions that distinguish your chosen policy from the alternatives.
- **No regressions**: existing reducer tests, App tests, and selectors all stay green.
- **Reducer purity**: state derivations stay in selectors, not duplicated inline in components.

## Submission

- Keep the repo runnable.
- Keep the tests green.
- Preserve the board layout while pinning the state-transition policies.
