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

Shared type definitions:
{type_definitions}

This file must export: {exports}

Dependencies (files this imports from and their exports):
{dependency_details_with_their_exports}

Available packages: {packages}

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
