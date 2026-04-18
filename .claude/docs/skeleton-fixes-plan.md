# Skeleton Fixes — Production-Ready Plan

Audit of the 4 uncommitted skeletons (`data-pipeline-insights`, `fullstack-support-hub`, `ops-cli-audit`, `react-orders-board`) surfaced 9 issues. Two design decisions have been made:

- **D1: tests in skeletons are regression guards only**, not the candidate's spec. Grading will be a separate feature engineered later.
- **D2: rubric is generated dynamically by the agent** from the user's prompt; the skeleton has no static rubric.

These decisions remove items #6 (no glob test coverage) and shrink the doc cleanup to two small edits. The remaining work is three independent batches.

**All 4 skeletons currently pass `library.test.ts` (install + tsc + vitest in temp dir, ~37s).** None of these fixes are blockers; they're polish to bring the skeletons to production-ready state.

---

## Batch A — Mechanical fixes

Single PR. ~15 min. Touches files across all 4 skeletons but every change is independent and additive.

### A1. Add `package-lock.json` to 3 manifests
- `src/skeletons/data-pipeline-insights/manifest.json`
- `src/skeletons/fullstack-support-hub/manifest.json`
- `src/skeletons/react-orders-board/manifest.json`

Add the entry (modeled on `ops-cli-audit/manifest.json:16-20`):
```json
{ "path": "package-lock.json", "role": "provided", "adapt": false, "purpose": "Pinned dependency graph for reproducible installs" }
```

Without this, `loadSkeleton()` won't copy the lockfile into candidate sandboxes — it sits in `files/` unused.

### A2. Fix `defineConfig` import in react-orders-board
`src/skeletons/react-orders-board/files/vite.config.ts:1`:
```diff
- import { defineConfig } from 'vite';
+ import { defineConfig } from 'vitest/config';
```
Other three skeletons already use `'vitest/config'`. Restores Vitest type-checking on the `test` block.

### A3. Stop polluting test stdout in data-pipeline-insights CLI
`src/skeletons/data-pipeline-insights/files/src/cli.ts:5-10` — move the `console.log` inside the `isDirectRun` branch:
```ts
export async function main(): Promise<string> {
  const report = await buildPipelineReport(sampleEvents);
  return renderPipelineReport(report);
}
// ...
if (isDirectRun) {
  main().then(console.log).catch(/* ... */);
}
```
Currently `cli.test.ts:6` invokes `main()` and the report dumps to stdout in CI.

### A4. Stable React key in OrderDetails
`src/skeletons/react-orders-board/files/src/components/OrderDetails.tsx:82`:
```diff
- {order.notes.map((note) => (
-   <li key={note}>{note}</li>
+ {order.notes.map((note, idx) => (
+   <li key={`${order.id}-note-${idx}`}>{note}</li>
```
Note text as a key throws a React warning when two notes share text.

### Verification
After A1-A4: `npx vitest run src/skeletons/__tests__/library.test.ts` must still pass.

---

## Batch B — fullstack-support-hub API/client mismatch

Single PR. ~20 min. Self-contained to `fullstack-support-hub`.

**Problem:** `server/app.ts:63-66` returns `{ ticket, summary }` from `POST /api/tickets/:id/notes`, but `client/api.ts:33` casts the response to `DashboardPayload` (`{ tickets, summary }`). `App.tsx:130-132` then calls `payload.tickets.find(...)` — crashes at runtime in any real browser session. Tests pass only because `App.test.tsx:78-83` mocks `addTicketNote` to return a properly-shaped payload.

**Fix:** Change the server to return the full dashboard (one-line change, no client edits needed):
```ts
// src/skeletons/fullstack-support-hub/files/src/server/app.ts:63-66
res.status(201).json({
  tickets: store.listTickets({}),
  summary: store.getSummary(),
});
```

**Add an integration assertion** to lock the contract — append to `src/server/app.test.ts`:
```ts
it("returns the refreshed dashboard payload after adding a note", async () => {
  const app = createApp();
  const response = await request(app)
    .post("/api/tickets/SH-201/notes")
    .send({ author: "Avery", body: "Following up." });

  expect(response.status).toBe(201);
  expect(response.body.tickets).toHaveLength(5);
  expect(response.body.summary).toBeDefined();
});
```

This makes the seam testable without depending on the App.tsx mock.

### Verification
- `cd src/skeletons/fullstack-support-hub/files && npx vitest run` — all 7 tests pass (was 6).
- Manual smoke (optional): `npm run server` + `npm run dev`, click "Add note" — should not crash.

---

## Batch C — Contract cleanup (was Batch D)

Single PR. ~10 min. Reflects D1 + D2 decisions in the contract doc and deletes the two orphan rubric files.

### C1. Delete orphan rubric files
- `rm src/skeletons/data-pipeline-insights/rubric.json`
- `rm src/skeletons/ops-cli-audit/rubric.json`

The agent emits its rubric into `_remix_metadata.json` per assessment based on the user's brief; static skeleton-level rubrics are dead weight.

### C2. Update `src/skeletons/SKELETON_CONTRACT.md`
- **Directory structure section:** drop the `rubric.json` line.
- **Validation contract section:** drop "Tests for `candidate` files may exist but are expected to fail (testing stubs)" — that statement contradicts `library.test.ts` and no longer reflects the design intent. Replace with: "All tests in the skeleton must pass (`vitest run` exit 0). Tests are regression guards on the reference state; candidate-grading is handled outside the skeleton."
- **Role definitions section:** soften the `candidate` role description to acknowledge it's an authoring hint, not a state requirement. Suggested rewrite:
  > **candidate**: The primary file the candidate's task focuses on. Ships as complete reference code (the agent only re-themes; it does not introduce gaps). The role label communicates intent to skeleton authors and downstream consumers.

### Verification
- `npx vitest run src/skeletons/__tests__/library.test.ts` still passes (only docs + orphan files changed).

---

## Batch ordering & parallelism

```
Batch A ──┐
Batch B ──┼─→ all green, ready to merge
Batch C ──┘
```

All three batches are fully independent (different files, no overlapping edits). Run them in parallel via `/batch` from a fresh session opened in `backend/`. The `/batch` skill keys off the session-start env which currently reports the parent dir as not-a-git-repo — opening directly in `backend/` fixes that.

## Out of scope

- Backfilling `rest-api-express` and `pulseboard-launch-sprint` (already-committed skeletons) with the same A1/A2/A3/A4-style fixes if any apply. Worth a follow-up scan once these batches land.
- The `generatedAt` hardcoded timestamp in `data-pipeline-insights/batch.ts:76`. Cosmetic; defer.
- Any work tied to candidate grading — explicitly deferred per D1.
