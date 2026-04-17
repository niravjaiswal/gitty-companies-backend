# M7 Implementation Plan — Web App Integration

Generated: 2026-04-17
Branch: main
Status: DRAFT — awaiting approval

## What's in and what's out

In scope (per phase1 plan lines 139–148):
- Skeleton picker in the assessment creation form.
- Role brief textarea + Generate button (already there; needs to flow to live pipeline, not demo).
- Job progress UI (poll every 3s, show generationStatus).
- On completion: open in the existing Monaco editor.
- Publish button finalizes the assessment.

Out of scope:
- Redesigning `CreateAssessment.tsx`. Keep the existing flow; add the picker + rewire the live-mode submit path.
- New Gitty-chat UI features (the dummy chat in the editor stays as-is).
- Changing the demo flow. Demo mode stays synchronous and unchanged.
- Progress streaming (SSE/WebSocket). Polling is fine at 3s and the spike showed jobs finish in ~2–4 min.
- Per-file diff preview. The reviewer opens the whole workspace in Monaco and edits in place.

## Current state (verified)

Backend already has everything needed except skeleton discovery:
- `POST /api/company/assessments` accepts `skeletonId` and returns **202** with `generation_status: "pending"` when `generateWorkspace && !demoMode`. (`assessmentRoutes.ts:256-425`)
- `GET /api/company/assessments/:id` returns `generationStatus`, `generationError`, `generationStartedAt`, `generationCompletedAt`, `workspaceFileCount`, and full `workspaceFiles` map. (`assessmentRoutes.ts:428-452`)
- `PATCH /api/company/assessments/:id` queues regeneration when content fields change. (`assessmentRoutes.ts:454-614`)
- `POST /api/company/assessments/:id/publish` already exists. (`assessmentRoutes.ts:616-648`)
- `GenerationQueue` picks up `pending` jobs, runs `remix()`, writes `workspace_files` + `generation_status="completed"`. (`generationQueue.ts`)
- `chooseSkeleton()` keyword heuristic is the auto-detect fallback. (`generationQueue.ts:81-96`)

Frontend already has:
- `CreateAssessment.tsx` — live/demo toggle, brief textarea, duration, submit.
- `AssessmentEditor.tsx` — Monaco + file tree + Save (PATCH `workspaceFiles`).
- `SendAssessment.tsx` — assignment + publish flow (per existing routes `/dashboard/send/:id`).
- `apiFetch` wrapper with auth.

What's missing:
1. No endpoint to list skeletons. Frontend can't render a picker without it.
2. `CreateAssessment.tsx` doesn't send `skeletonId` and navigates away before knowing if live generation succeeded — the user lands on `/dashboard/send/:id` staring at an empty workspace for 3 minutes.
3. No generation-progress page. Opening the editor on a pending job shows "No generated files found."

## Design principle

Keep the demo flow exactly as it is (fast path, teams use it for sales demos). Make the live path feel like a real async job: pick skeleton → see progress → open in editor → publish. Do not couple the progress UI to the editor — separate routes so polling state and editor state don't fight each other.

## Backend changes

### B1. New endpoint: `GET /api/company/skeletons`

Returns metadata for every skeleton directory under `src/skeletons/` (excluding `__tests__`). Used by the picker.

Response shape:
```ts
type SkeletonListItem = {
  id: string;                // directory name, e.g. "react-orders-board"
  name: string;              // skeleton.json `name`
  language: "typescript" | "python";
  pattern: "react-spa" | "rest-api" | "cli-tool" | "data-processing" | "full-stack" | "real-time";
  description: string;
  domainTags: string[];
  skillAxes: string[];
  difficultyRange: { min: string; max: string };
  estimatedScope: { min: string; max: string };
};
```

Implementation:
- New file `src/app/modules/assessments/skeletonListRoutes.ts` (or inline into `assessmentRoutes.ts` — inline is fine for one endpoint and matches current layout).
- Reuse `loadSkeleton` from `src/skeletons/loader.ts` for each directory. (Cheap; only reads `skeleton.json` + `manifest.json`, ~10 files total.)
- Cache the result in-process on first request. Skeletons don't change at runtime.
- Auth: same `authenticate` preHandler. No company-specific filtering — skeleton library is global.

### B2. Nothing else

No other backend changes. The 202 + polling contract and the queue already work. PATCH regeneration already works. Publish already works.

## Frontend changes

### F1. `lib/api.ts` type helpers

Add `SkeletonListItem` type and an `assessmentApi` object with typed wrappers for the three calls we'll hit repeatedly:
- `listSkeletons(): Promise<SkeletonListItem[]>`
- `getAssessment(id): Promise<AssessmentDetail>`
- `createAssessment(body): Promise<AssessmentDetail>`

Not required, but cleans up the pages. If it sprawls, keep it minimal — just the skeleton list call.

### F2. `pages/CreateAssessment.tsx` — skeleton picker + live route rewire

Changes only apply when `demoMode === false`:
- Fetch skeletons on mount, stash in state.
- Render a picker: "Auto-detect" card + one card per skeleton. Each card shows `name`, `pattern`, `description`, and 2–3 `skillAxes` badges. Clicking selects `skeletonId`.
- Default: "Auto-detect" (`skeletonId = null`).
- Include `skeletonId` in the POST body when non-null.
- On successful submit in live mode, navigate to `/dashboard/assessments/:id/generation` instead of `/dashboard/send/:id`.
- Demo mode keeps its current navigation to `/dashboard/send/:id`.

UI placement: put the picker above the "Prompt" textarea in the live-mode branch. Keep current styling (signal-panel cards). Hide entirely in demo mode so the sales demo stays unchanged.

### F3. New page: `pages/AssessmentGeneration.tsx`

Route: `/dashboard/assessments/:id/generation`.

Behavior:
- On mount, `GET /api/company/assessments/:id`. Save `assessment` to state.
- Poll same endpoint every 3 seconds while `generationStatus` is `"pending"` or `"processing"`.
- Stop polling when status is `"completed"`, `"failed"`, or `null` (demo mode should never land here, but guard).
- Render states:
  - **pending / processing:** Show skeleton name, elapsed time since `generationStartedAt` (or `createdAt` if not yet started), an animated progress bar, and a "Cancel" link that goes back to `/dashboard`.
  - **completed:** Show a success card with `workspaceFileCount` and a primary CTA "Review in editor" → `/dashboard/assessments/:id/editor`.
  - **failed:** Show the `generationError` in a code block, plus two buttons: "Regenerate" (PATCH `regenerateWorkspace: true`) and "Edit brief" → `/dashboard/create` (for now; we don't have a "re-edit" route yet).
- Budget assumption: typical runs are 2–4 min. If `elapsed > 10 min` show a "This is taking longer than expected — the stale-job recovery will reset it" note. Don't block.

Implementation notes:
- Use `useEffect` with `setTimeout` (not `setInterval`) so we don't stack calls if one is slow. Clear on unmount.
- Style-match the existing `signal-panel` / `editorial-grid` aesthetic.

### F4. `pages/AssessmentEditor.tsx` — guard against pending jobs

Small change: when `workspaceFileCount === 0` and `generationStatus` is `"pending"` / `"processing"`, redirect to `/dashboard/assessments/:id/generation` instead of showing "No generated files found." Avoids the current dead-end UX.

No other editor changes. Save + entry-file selection + publish already work.

### F5. `App.tsx` — register the new route

Add between `/dashboard/assessments/:id/editor` and `/dashboard/assessments/:assessmentId/results`:

```tsx
<Route
  path="/dashboard/assessments/:id/generation"
  element={<ProtectedRoute><AssessmentGeneration /></ProtectedRoute>}
/>
```

### F6. Publish button

Already exists in `SendAssessment.tsx` and/or the editor save/publish flow. Confirm after implementation that the completed editor path surfaces publish correctly; if not, add a single "Publish" LiquidButton next to "Save files" in `AssessmentEditor.tsx` that POSTs `/api/company/assessments/:id/publish`.

## File-touch summary

| File | Change |
|------|--------|
| `backend/src/app/modules/assessments/assessmentRoutes.ts` | Add `GET /api/company/skeletons` handler |
| `frontend/src/lib/api.ts` | Add `SkeletonListItem` type |
| `frontend/src/pages/CreateAssessment.tsx` | Add skeleton picker, route live-mode submit to generation page |
| `frontend/src/pages/AssessmentGeneration.tsx` | NEW — polling progress UI |
| `frontend/src/pages/AssessmentEditor.tsx` | Redirect to generation page when workspace is pending; verify Publish |
| `frontend/src/App.tsx` | Register `/dashboard/assessments/:id/generation` route |

## Test plan

- Run `npm run tsc` + `npm run test` in both `backend` and `frontend`.
- Happy path: create assessment in live mode with explicit skeleton → see progress → wait ~3 min → land in editor → save an edit → publish.
- Auto-detect: leave picker at "Auto-detect" with a frontend-flavored brief → verify backend picks `react-orders-board` or similar.
- Failure path: pick a skeleton, submit, kill the backend before queue picks it up, restart — stale recovery should re-queue it; UI should keep polling.
- Direct-URL edge: navigate straight to `/dashboard/assessments/:id/editor` for a pending job → should redirect to generation page.
- Demo mode unchanged: toggle demo on, submit, verify no skeleton picker rendered, still navigates to `/dashboard/send/:id`.

## Risks and mitigations

- **Long poll when agent stalls.** Stale-job recovery already handles this on the backend (10 min cutoff). UI just needs the informational note past 10 min.
- **Skeleton list cache stale.** Only relevant if we add a skeleton without restarting the server. Cache TTL not needed for M7; ship fresh-load-per-restart.
- **Editor guard causes redirect loop.** The editor redirects to `/generation` when pending; `/generation` redirects to `/editor` when completed. Safe as long as `completed` state is stable — which it is, since the queue only writes `completed` after `workspace_files` is populated in the same UPDATE. No race.

## Decision

Implement in this order: B1 → F5 → F3 → F2 → F4 (+ F6 verify). Each step is independently testable.
