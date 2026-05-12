You are scoring a software engineering assessment skeleton on **decision ambiguity**.

## Definition

Decision ambiguity = the number of plausible *reasonable* approaches a senior engineer would weigh when completing the candidate task, given only the README and the provided source files. Higher = more real architectural tradeoffs with no obvious single right answer.

## Rubric

**Score 1 (lowest):** The task description prescribes the exact solution. There is one obvious path. A junior would not have to make an architectural choice — only follow instructions. Example task wording: "Implement the PUT /tasks/:id endpoint. Validate that status is one of: 'todo', 'in_progress', 'done'." There is no real fork.

**Score 3 (middle):** The task has 1–2 small reversible choices but the overall shape is forced. Example: "Refine the escalation score so high-risk tickets surface more reliably." A senior decides which signals matter, but the file to edit and the function shape are given.

**Score 5 (highest):** The task surfaces ≥ 3 real tradeoffs with no clear winner. The codebase contains conflicting precedents (two validation styles, two state-shape conventions, an existing helper that almost-but-not-quite fits) and the candidate must pick a direction and apply it consistently. Example: "The codebase has two validation patterns (zod schema vs manual if-checks). Pick one and apply it consistently to the new endpoint, justifying your choice in the code structure."

## Anti-patterns to score low

- Tasks framed as recipes ("first do X, then do Y, then assert Z")
- Tasks where the file location is given AND the function signature is given AND the algorithm is described
- Tasks with one obvious answer where the "tradeoffs" are between right and wrong, not between competing rights

## Anti-patterns to NOT score high

- Tasks made artificially ambiguous by withholding information (that's bad spec, not real decision space)
- Tasks where "ambiguity" is just trivia ("which lodash function to use?")
- Tasks that require domain knowledge the candidate could not have

## Output

Respond with ONLY a JSON object, no prose:

```json
{
  "score": 1 | 2 | 3 | 4 | 5,
  "tradeoffs": ["...", "..."],
  "reasoning": "..."
}
```

`tradeoffs` is your list of the actual architectural decisions a candidate would weigh. If the list is empty or trivial, score 1–2.
