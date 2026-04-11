# Skeleton Contract

Every skeleton in this directory is a self-contained, working project that serves as the structural foundation for AI-remixed assessments.

## Directory structure

```
skeleton-name/
├── skeleton.json          # Metadata: name, language, pattern, difficulty range,
│                          #   skill_axes, estimated_scope, domain_tags, description
├── manifest.json          # File roles (provided/candidate/partial) and adapt flags
├── src/                   # Source files with generic hardcoded content
├── tests/                 # Working test suite
├── package.json           # Working dependencies (pinned versions)
├── tsconfig.json          # Working compiler config
├── vitest.config.ts       # Working test config
├── README.md              # Template with {{scenario}}, {{tasks}}, {{rubric}} placeholders
└── rubric.json            # Evaluation criteria with {{weight}} placeholders
```

## Validation contract

Every skeleton MUST pass these checks before it can be used for remixing:

```bash
npm install && tsc --noEmit && vitest run
```

- `npm install` must complete without errors
- `tsc --noEmit` must produce zero type errors
- `vitest run` must pass all tests for "provided" files
- Tests for "candidate" files may exist but are expected to fail (testing stubs)

## Placeholder rules

- `{{variable}}` tokens are allowed ONLY in: `README.md`, `rubric.json`, `skeleton.json` description fields
- Source code (`.ts`, `.tsx`, `.js`, etc.) has NO placeholders
- Source code uses generic hardcoded values (e.g., "Assessment Dashboard" not `{{title}}`)
- The AI remix layer (Sonnet) adapts source files via full-file replacement, not placeholder substitution

## Manifest roles

Each file in `manifest.json` has:

| Field | Type | Description |
|-------|------|-------------|
| `path` | string | Relative path from skeleton root |
| `role` | enum | `provided` (given to candidate), `candidate` (candidate must write), `partial` (starter code candidate extends) |
| `adapt` | boolean | Whether the AI remix layer should modify this file |
| `purpose` | string | Human-readable description of the file's role |

### Role definitions

- **provided**: Code given to the candidate as-is. Tests for provided files must pass.
- **candidate**: Files the candidate must implement. May contain stubs. Tests for candidate files are expected to fail against stubs.
- **partial**: Starter code with gaps. The candidate extends it. Some tests pass, some fail.

### Adapt flag

- `adapt: true` — File is sent to the LLM during remix. The LLM returns a full replacement.
- `adapt: false` — File is NEVER sent to the LLM. `apply-patch` rejects any patches targeting static files. Use for: config files (`tsconfig.json`, `vitest.config.ts`, `package.json`), test harness setup, and structural plumbing that must not change.

## Patch format

The remix engine outputs a JSON object validated against `RemixPatchSchema`:

```json
{
  "scenario": {
    "title": "...",
    "company_name": "...",
    "narrative": "..."
  },
  "file_patches": [
    {
      "path": "src/types/index.ts",
      "action": "replace_content",
      "content": "// Full adapted file content..."
    }
  ],
  "tasks": [...],
  "rubric": [...]
}
```

- Each `file_patches` entry contains the COMPLETE adapted file content (not diffs)
- Only files with `adapt: true` in the manifest are valid patch targets
- Patches for unknown paths or static files are rejected
- Missing patches for adapt-marked files generate a warning (the file keeps its original content)
