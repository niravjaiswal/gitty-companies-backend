# Pulseboard Launch Sprint

A React + TypeScript launch-readiness dashboard. The state and the rules
that govern it have already been split across two layers, and the candidate
job is to finish the consolidation cleanly while shipping a small product
feature on top.

## Sandbox commands

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 3000
npm run test
```

## Where things live

- `src/App.tsx` — top-level dashboard. Wires the panels and forwards the
  launch-task state and actions into them.
- `src/hooks/useLaunchTasks.ts` — encapsulates the launch-task state
  (tasks, filter, query, composer error) and exposes a single API the page
  consumes.
- `src/lib/launchTasks.ts` — pure helpers for the launch-task logic:
  `validateDraftTask`, `nextTaskId`, `applyTaskFilter`, `computeLaunchScore`,
  `statusLabel`. No React.
- `src/components/Composer.tsx` — task creation form. Owns its own form
  state and calls back through `onAddTask`.
- `src/components/ItemList.tsx`, `SidebarSummary.tsx`, `MetricGrid.tsx`,
  `TimelineFeed.tsx` — presentational pieces.

The split means there are three legitimate places a behavioral change could
land: in the pure helper, in the hook, or in the page. Picking the right
one is part of the assessment.

## Core task — finish the launch composer

When you submit the composer right now, a launch task is added to the
checklist. Your job is to harden the workflow end to end:

1. **Validation** — a submission with an empty title, owner, or lane must
   surface the error message in the composer and not append a task. The
   pure helper `validateDraftTask` already encodes the required-field rule
   and trims input; make sure the wiring through `useLaunchTasks` and
   `Composer` actually surfaces failures and clears the form on success.
2. **Search and filter must include new tasks** — a task added through the
   composer should immediately respect the active status filter and search
   query without an extra interaction. Verify this against `applyTaskFilter`.
3. **Launch score must move** — the `Ready / Watch / Blocked` counts and
   the launch-score percentage in the sidebar must recompute as tasks are
   added or as their statuses change. The math lives in
   `computeLaunchScore` and must not divide by zero on an empty list.

## Decisions you need to make explicit

These are not stylistic — pick one and apply it consistently. Document the
choice in your submission notes.

- **Where does composer state live?** Today the form keeps its own field
  values inside `Composer`, while the *result* of submission flows up
  through `useLaunchTasks`. If you change validation behavior (e.g., live
  feedback as the user types), be deliberate about which side owns it.
  Don't lift form state up just because you can — only if a feature
  outside the form needs it.
- **What status does a malformed submission get?** `validateDraftTask`
  currently falls back to `"watch"` when the status string is not in the
  enum. If you treat malformed status as a hard error instead, update both
  the helper and its tests; do not patch only the call site.
- **How does the hook react to the initial task list changing?**
  `useLaunchTasks(initial)` snapshots `initial` once. If you decide to
  re-sync when `initial` changes (for example to re-seed in tests),
  document that contract on the hook and add a test for it. Otherwise,
  keep the snapshot semantics and reject the temptation to add a `useEffect`
  for a problem you do not have.

## Testing

- `src/lib/__tests__/launchTasks.test.ts` covers the pure helpers
  (validation, id generation, filter composition, score boundaries,
  status labels). If you change a rule, update these first — they are the
  cheapest place to lock behavior.
- `src/App.test.tsx` covers the page-level integration (filter, search,
  add task, form clearing). Treat these as a contract for the user-visible
  behavior. Adding higher-coverage component-level tests for `Composer` is
  welcome but not required.

Run them all with `npm run test`.

## Submission

- Keep the repo runnable.
- Keep all tests green.
- Briefly note the decisions you made above in the submission notes so the
  reviewer can read your code with the same model you wrote it under.
- Use the in-product submit button when you are done.
