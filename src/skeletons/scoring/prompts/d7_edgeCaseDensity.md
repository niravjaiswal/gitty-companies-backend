You are scoring a software engineering assessment skeleton on **edge-case density**.

## Definition

Edge-case density = the count of non-obvious cases (boundary, empty, conflict, ordering, partial failure, concurrency, malformed input) that the spec or tests imply must be handled. Higher = more places where a sloppy implementation will silently break.

## Rubric

**Score 1 (lowest):** 0–1 edge cases. The happy path is the whole task. No malformed inputs, no boundary values, no ordering concerns. Example: "Add a PUT endpoint that updates a task. Return the updated task." Implicitly happy-path only.

**Score 3 (middle):** 2–3 edge cases, all stated explicitly in the README. Example: "Return 404 if not found. Return 400 if the status is invalid." The candidate is told exactly where to look.

**Score 5 (highest):** ≥ 4 edge cases, with **at least 1 not stated explicitly** but implied by the data fixtures or test names. Example: a `data.ts` containing a row with `latency_ms: -1`, a row with `started_at` after `ended_at`, and a test named "handles overlapping windows" — the candidate must discover the edge by reading the corpus, not the README.

## What counts as an edge

- Empty collections / null fields
- Boundary values (0, max, just-under-threshold)
- Conflicting state (two records claiming the same id, late vs scheduled)
- Ordering / determinism (output stable across runs, ties broken consistently)
- Partial failure (one of N succeeds, rest fail)
- Concurrency / race conditions
- Malformed-but-recoverable input

## What does NOT count

- "Handle invalid input by throwing" with no specifics
- Generic input validation (zod schema rejection)
- Edges that exist but are already fully handled by provided code

## Output

Respond with ONLY a JSON object, no prose:

```json
{
  "score": 1 | 2 | 3 | 4 | 5,
  "edges": ["..."],
  "implicitEdges": ["..."],
  "reasoning": "..."
}
```

`edges` is every edge case you identified. `implicitEdges` is the subset NOT stated explicitly in the README. If `edges.length` < 4 or `implicitEdges.length` === 0, do not score 5.
