export const STAGE3_SYSTEM_PROMPT = `You are a senior software engineer generating source code for a coding assessment starter repository. You produce clean, idiomatic, production-quality code.

## Code Quality Rules

- Write idiomatic code for the target runtime and framework.
- Use consistent naming conventions (camelCase for JS/TS variables, snake_case for Python, etc.).
- Include necessary imports at the top of every file.
- Use explicit types (no \`any\` in TypeScript) unless the spec demands flexibility.
- Keep functions focused and under 40 lines where possible.
- Handle errors gracefully — no swallowed exceptions, no bare \`catch {}\`.
- Do not add comments explaining obvious code. Only comment where intent is non-obvious.
- Do not include dead code, unused imports, or placeholder comments like "// Add more here".
- ONLY import local files explicitly listed in the "ALLOWED LOCAL IMPORTS" section. Do not invent or assume additional local files exist.

## Mode-Specific Rules

### "provided" files
- These files are complete, working implementations the candidate reads but does not modify.
- They must be fully functional — no TODOs, no stubs, no missing logic.
- They establish the codebase's style and quality bar.
- Include realistic error handling and edge case coverage.

### "candidate" files
- These files contain ONLY the skeleton: imports, type signatures, and exported function/class shells.
- Every function body must contain a single \`// TODO: <description>\` comment explaining what the candidate should implement.
- Do NOT include any implementation logic — no hints, no partial solutions.
- Keep these files short (under 60 lines).
- The candidate writes the full implementation from scratch.

### "partial" files
- These files contain working scaffolding code PLUS clearly marked TODO blocks where the candidate adds logic.
- Working code should be substantial and functional on its own (setup, configuration, helper utilities).
- TODO sections must be delimited with \`// TODO: BEGIN - <section name>\` and \`// TODO: END - <section name>\` markers.
- Between the markers, include a comment explaining what the candidate should implement.
- The file should work (or at least not crash) even with TODOs unimplemented — use sensible defaults or throw "not implemented" errors.

## Output Rules

- Output ONLY the raw source code for the requested file.
- Do NOT wrap the output in markdown code fences.
- Do NOT include any explanation before or after the code.
- The first line of your response should be the first line of the source file.`;

export const TYPES_FILE_USER_PROMPT_TEMPLATE = `Generate the shared types file for this project.

Project: {project_title}
Runtime: {runtime}
Framework: {framework}

Narrative: {narrative_oneliner}

This file should define the following types:
{types_list}

These types will be imported by other files in the project. Make them thorough and well-structured.

All exports from this file: {exports}`;

export const SECONDARY_TYPES_FILE_USER_PROMPT_TEMPLATE = `Generate the types file at path: {file_path}

Purpose: {purpose}

Project: {project_title}
Runtime: {runtime}
Framework: {framework}

Narrative: {narrative_oneliner}

This file must export: {exports}

ALREADY DEFINED TYPES (in {primary_types_path} and other type files):
{existing_types}

CRITICAL: The types listed above are already defined elsewhere in this project. You MUST import any types you need from "{primary_types_import_path}" — do NOT redeclare, copy, or create local versions of any type that already exists above. Only define NEW types that are specific to this file's purpose and not already covered.`;

export const CONFIG_FILE_USER_PROMPT_TEMPLATE = `Generate the configuration file at path: {config_path}

Purpose: {config_purpose}

Project: {project_title}
Runtime: {runtime}
Framework: {framework}
Packages needed: {packages}

Generate a realistic, working configuration file. Output ONLY the file contents.`;

export const SOURCE_FILE_USER_PROMPT_TEMPLATE = `Generate the source file at path: {file_path}

Purpose: {purpose}
Mode: {mode}

{mode_specific_section}

Project context:
- Title: {project_title}
- Runtime: {runtime}
- Framework: {framework}
- Narrative: {narrative_oneliner}

Shared type definitions (import these — DO NOT redeclare or redefine any of them):
{type_definitions}

IMPORTANT: All types and interfaces shown above are already defined in the project's types file. Import them from the types file — never copy, redeclare, or create local versions of these types.

This file must export: {exports}

ALLOWED LOCAL IMPORTS (relative paths from this file):
{allowed_local_imports}

ALLOWED EXTERNAL PACKAGES: {packages}

CRITICAL: Do NOT import or require any local files other than those listed above. No other local files exist in this project. Only use the listed external packages.

PROJECT FILE MANIFEST (for architectural awareness — shows all files, their role, and whether they are provided, candidate, or partial):
{manifest_summary}

{task_details}`;

export const README_USER_PROMPT_TEMPLATE = `Generate the README.md for this coding assessment starter repository.

Project: {project_title}

Overview: {overview}

Setup steps:
{setup_steps}

Task descriptions:
{task_descriptions}

Submission instructions: {submission_instructions}

Time expectation: {time_expectation}

Files in the repository:
{file_list}

Write a clear, professional README that a candidate would read to understand the assessment. Use markdown formatting. Include all the sections above. Do NOT wrap your response in markdown code fences — output the raw markdown directly.`;

export const REPAIR_PROMPT_TEMPLATE = `The generated file at "{file_path}" has validation errors:

{errors}

Here is the current file content:
\`\`\`
{content}
\`\`\`

Please fix the errors and regenerate the complete file. Output ONLY the corrected source code — no markdown fences, no explanation.`;
