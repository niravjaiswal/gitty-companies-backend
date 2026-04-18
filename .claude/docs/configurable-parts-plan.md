# Configurable Candidate-Brief Parts — Implementation Plan

Generated: 2026-04-18
Branch: main

## Decisions locked in

- **No max parts cap** (user directive). Guard with a soft ceiling of 26 (natural A–Z letter limit) at the Fastify schema + normalizer boundary to avoid prompt/regex pathologies. This is a bound, not a product-facing cap.
- **Exam specifics = freeform textarea**, 5000 char cap.
- **Default partCount = 1**.
- **Storage = `authoring_config` JSONB**, no new migration.
- **MVP excludes brief-only regen.** Any authoring_config change triggers full remix (same as today). Revisit later with a `generation_metadata` column.

## Terminology

- **Skeleton**: starter repo in `backend/src/skeletons/<id>/` with canned `assessment_copy`.
- **`authoring_config`** (migration `006`): jsonb default `{"mode":"single","stages":[]}`. Extending in place.
- **Target shape**: `{ mode, stages, partCount?: number, examSpecifics?: string }`.
- **`normalizeAuthoringConfig`** lives at `backend/src/app/modules/assessments/assessmentWorkspace.ts:84`. Silently drops unknown keys — must extend.
- **Two Fastify JSON schemas** (POST `assessmentRoutes.ts:294–330`, PATCH lines 493–532) — both need widening.

## 1. Authoring-config schema extension

**File:** `backend/src/app/modules/assessments/assessmentWorkspace.ts`

1. Add to `AssessmentAuthoringConfig`: `partCount?: number;` and `examSpecifics?: string;` (both optional — legacy rows deserialize cleanly).
2. Extend `normalizeAuthoringConfig`:
   - `partCount`: accept number only; clamp to `[1, 26]`; non-number or out-of-range → `undefined` (will default to 1 downstream).
   - `examSpecifics`: accept string only; `.trim()`; `.slice(0, 5000)`; empty → `undefined`.
3. Update **both** Fastify JSON schemas in `assessmentRoutes.ts`:
   ```
   partCount: { type: 'integer', minimum: 1, maximum: 26 },
   examSpecifics: { type: 'string', maxLength: 5000 },
   ```

**Risk:** Fastify strips undeclared fields when a schema is declared. Missing one endpoint = silent regression. Declare on both.

**No Zod added at HTTP boundary.** Existing pattern: Fastify JSON-schema validates inputs, `normalizeAuthoringConfig` validates at persistence. Keep it.

## 2. Brief generator module

### 2.1 `backend/src/remix/generate-brief.ts` (NEW)

- Export `generateInstructionsBrief(input) → Promise<{ instructionsMd, usage }>`.
- Input: `{ brief, assessmentCopy?, examSpecifics?, scenario, tasks, rubric, partCount }`.
- Model: `claude-haiku-4-5-20251001`, `maxTokens: 2048`, `temperature: 0`.
- Use `callLlm` (markdown output, not JSON).

### 2.2 `backend/src/remix/generate-brief-prompts.ts` (NEW)

System prompt contract:
- Emit ONLY markdown.
- Start with `# <Title>` on line 1.
- Sections in order: `## Overview`, `## Company codebase`, `## Part A`, `## Part B`, ... up to `## Part <letter(N-1)>`.
- Part convention: A = must-ship core, B = follow-up scope, C = stretch, D+ = bonus targets.
- 3–6 bullets per part under a 1-sentence framing line. Reference specific files/behaviors from tasks.

User prompt: JSON-dump the brief fields, skeleton canned copy (context only), examSpecifics (hard requirements), and scenario/tasks/rubric from the agent pass.

### 2.3 Validation + fallback

After the LLM call:
- Strip ```` ``` ```` fences if present.
- Regex-validate `## Overview`, `## Company codebase`, and each `## Part <letter>` up to N.
- On failure: single retry with error feedback (pattern from `extract-brief.ts:50-77`).
- On second failure: synthesize a fallback brief that wraps the output as `## Part A`. **Never throw** — workspace code is the expensive artifact.

## 3. Integrate into `remix()`

**File:** `backend/src/remix/remix.ts`

1. `RemixOptions` (types.ts): add `partCount?: number; examSpecifics?: string;`.
2. `RemixResult` (types.ts): add `instructionsMd: string;` and optional `usage.brief?: TokenUsage;`.
3. After the repair branch at `remix.ts:55`, call `generateInstructionsBrief` only when `verified === true`. Wrap in try/catch — brief failure should never fail remix.
4. Return `instructionsMd` on the result.
5. Export `generateInstructionsBrief` from `remix/index.ts`.

**Why inside remix():** `scenario/tasks/rubric` live on `workspace`; passing across the seam is noisy. Brief gen is ~1–2k tokens, cheap enough to gate behind `verified`.

## 4. Wire `generationQueue.ts`

**File:** `backend/src/app/modules/generation/generationQueue.ts`

1. In `processJob`, normalize `row.authoring_config` → extract `partCount` + `examSpecifics`.
2. Pass to `remix({ skeletonId, jobBrief, partCount, examSpecifics })`.
3. **Fix feedback loop (pitfall #2):** current `jobBrief` = `[title, summary, sourceBrief, instructions].join('\n\n')`. Once we start overwriting `instructions_md` with the structured brief, regeneration re-feeds it into the next `jobBrief`. **Change:** drop `instructions_md` from jobBrief concat. Use `[title, summary, sourceBrief].join('\n\n')` only. `source_brief` already holds the raw recruiter prompt.
4. On success: `update({ instructions_md: result.instructionsMd || instructions, ... })` — only overwrite if non-empty.

**Destructive note:** `instructions_md` column will transition from "raw recruiter prompt" → "structured markdown brief". `source_brief` column already stores the raw prompt, so no data is lost. Document in release note.

## 5. PATCH regeneration semantics

**Scope:** no brief-only regen in MVP. Any authoring_config change (partCount, examSpecifics) triggers full regen via the existing `shouldRegenerateWorkspace` path. No handler changes needed if `authoringConfig` comparison already detects field diffs.

**Verify:** inspect `assessmentRoutes.ts:594-613` — confirm `authoringConfig` change detection works on extended shape. If it uses `JSON.stringify`, extending the shape works transparently. If it spot-checks specific keys, extend that check.

## 6. Frontend intake — `CreateAssessment.tsx`

**File:** `frontend/src/pages/CreateAssessment.tsx`

1. Constant `EXAM_SPECIFICS_MAX = 5000`.
2. Two new `useState`: `intakeExamSpecifics`, `intakePartCount` (default `'1'`).
3. Two new form blocks on the intake panel (after JD textarea, before repo URL):
   - "Assessment specifics" Textarea with char counter, `min-h-[120px]`, marked Optional.
   - "Number of parts" numeric Input, `min={1} max={26}`, with helper text: "1 for a focused sprint, 2–3 for progressive scope."
4. Extend POST `authoringConfig` payload:
   ```
   authoringConfig: {
     mode: 'single',
     stages: [],
     partCount: Math.max(1, Math.min(26, Number(intakePartCount) || 1)),
     examSpecifics: intakeExamSpecifics.trim() || undefined,
   }
   ```

## 7. Frontend parser refactor — `assessmentBrief.ts`

**File:** `frontend/src/lib/assessmentBrief.ts`

1. New shape: `{ overview, companyCodebase, parts: string[] }`.
2. Parser loops A–Z; stops at first empty letter beyond A. Always includes `parts[0]` (even empty) so UI can show fallback.
3. `buildAssessmentBrief` takes `{ overview, companyCodebase, parts }`.
4. Export `partLabel(i)` → `"Part A"` / `"Part B"` / ...

### Callsite migrations (4 files, ~25 lines)

- **AssessmentEditor.tsx:157-168** — `briefSections.parts.flatMap(...)`.
- **CandidateResult.tsx:176-194, 338-354** — index access `parts[0]`/`parts[1]` with fallbacks; grid spread over `parts.map`.
- **SendAssessment.tsx:87-90, 249-278** — truthy check `parts.some(Boolean)`; grid spread.
- `lib/assessmentBrief.ts` itself.

Grep confirmed no other consumers.

## 8. Tests

### 8.1 Existing tests — none break.
### 8.2 New tests (recommended, not blocking)
- `frontend/src/lib/assessmentBrief.test.ts` — parser edge cases + round-trip.
- Extend `assessmentWorkspace.test.ts` with `normalizeAuthoringConfig` cases (clamp, slice, defaults).
- `generate-brief.test.ts` optional (requires LLM mock).

## 9. Non-obvious pitfalls

1. `authoring_config` PATCH without partCount → zeroes it out. Expected; document.
2. **Feedback loop fix (critical):** see section 4 — drop `instructions_md` from `jobBrief`.
3. Fastify strips undeclared fields with a schema. Declare on both POST + PATCH.
4. `stages` is currently unused. Document that `partCount` is the new surface for multi-stage — collapse `stages` in a follow-up.
5. Prompt-injection via `examSpecifics` is low-severity (output → candidate UI, not chained LLM calls).
6. `assessment_copy` is optional on some skeletons; prompt builder handles undefined.
7. Brief failure with empty `instructionsMd` but status `completed` is misleading. Acceptable for MVP; recruiter can re-publish.

## 10. Implementation order

1. Backend types + normalizer (`assessmentWorkspace.ts`).
2. Backend JSON schemas (POST + PATCH in `assessmentRoutes.ts`).
3. `RemixOptions` / `RemixResult` types.
4. `generate-brief-prompts.ts` (pure strings).
5. `generate-brief.ts` (Haiku call + retry + fallback).
6. Integrate into `remix.ts`.
7. `generationQueue.ts` wiring + feedback-loop fix.
8. Frontend parser + `buildAssessmentBrief` + `partLabel`.
9. Frontend callsite migrations.
10. Frontend intake UI.
11. Optional tests.

## Critical files

- `backend/src/app/modules/assessments/assessmentWorkspace.ts`
- `backend/src/app/modules/assessments/assessmentRoutes.ts`
- `backend/src/remix/remix.ts`, `types.ts`, `index.ts`, `generate-brief.ts` (new), `generate-brief-prompts.ts` (new)
- `backend/src/app/modules/generation/generationQueue.ts`
- `frontend/src/lib/assessmentBrief.ts`
- `frontend/src/pages/CreateAssessment.tsx`, `AssessmentEditor.tsx`, `CandidateResult.tsx`, `SendAssessment.tsx`
