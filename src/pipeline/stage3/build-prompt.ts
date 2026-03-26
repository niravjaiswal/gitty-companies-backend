import type { ScenarioDesign } from "../stage2/scenario-schema.js";
import type { CompressedContext } from "./build-context.js";
import {
  TYPES_FILE_USER_PROMPT_TEMPLATE,
  SECONDARY_TYPES_FILE_USER_PROMPT_TEMPLATE,
  CONFIG_FILE_USER_PROMPT_TEMPLATE,
  SOURCE_FILE_USER_PROMPT_TEMPLATE,
  README_USER_PROMPT_TEMPLATE,
  REPAIR_PROMPT_TEMPLATE,
} from "./prompts.js";

type ManifestFile = ScenarioDesign["starter_repo"]["manifest"][number];
type CandidateTask = ScenarioDesign["candidate_tasks"][number];

export function computeRelativeImportPath(fromFile: string, toFile: string): string {
  const fromDir = fromFile.includes("/") ? fromFile.substring(0, fromFile.lastIndexOf("/")) : ".";
  const toDir = toFile.includes("/") ? toFile.substring(0, toFile.lastIndexOf("/")) : ".";
  const toBasename = toFile.includes("/") ? toFile.substring(toFile.lastIndexOf("/") + 1) : toFile;

  // Strip extension from the basename
  const toName = toBasename.replace(/\.[jt]sx?$/, "");

  if (fromDir === toDir) {
    return `./${toName}`;
  }

  const fromParts = fromDir === "." ? [] : fromDir.split("/");
  const toParts = toDir === "." ? [] : toDir.split("/");

  // Find common prefix length
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++;
  }

  const ups = fromParts.length - common;
  const downs = toParts.slice(common);

  if (ups === 0) {
    return "./" + [...downs, toName].join("/");
  }

  const segments = [...Array(ups).fill(".."), ...downs, toName];
  return segments.join("/");
}

export function buildTypesFilePrompt(
  context: Omit<CompressedContext, "type_definitions">,
  typesList: string,
): string {
  const typesEntry = Object.entries(context.all_exports).find(([path]) =>
    /types\.[jt]s$/.test(path),
  );
  const exports = typesEntry ? typesEntry[1].join(", ") : "";

  return TYPES_FILE_USER_PROMPT_TEMPLATE
    .replaceAll("{project_title}", context.project_title)
    .replaceAll("{runtime}", context.runtime)
    .replaceAll("{framework}", context.framework ?? "none")
    .replaceAll("{narrative_oneliner}", context.narrative_oneliner)
    .replaceAll("{types_list}", typesList)
    .replaceAll("{exports}", exports);
}

export function buildSecondaryTypesFilePrompt(
  context: Omit<CompressedContext, "type_definitions">,
  entry: ManifestFile,
  primaryTypesPath: string,
  existingTypes: string,
): string {
  const primaryImportPath = computeRelativeImportPath(entry.path, primaryTypesPath);

  return SECONDARY_TYPES_FILE_USER_PROMPT_TEMPLATE
    .replaceAll("{file_path}", entry.path)
    .replaceAll("{purpose}", entry.purpose)
    .replaceAll("{project_title}", context.project_title)
    .replaceAll("{runtime}", context.runtime)
    .replaceAll("{framework}", context.framework ?? "none")
    .replaceAll("{narrative_oneliner}", context.narrative_oneliner)
    .replaceAll("{exports}", entry.exports.join(", "))
    .replaceAll("{primary_types_path}", primaryTypesPath)
    .replaceAll("{primary_types_import_path}", primaryImportPath)
    .replaceAll("{existing_types}", existingTypes);
}

export function buildConfigFilePrompt(
  configPath: string,
  configPurpose: string,
  scenario: ScenarioDesign,
  spec: { runtime: string | null; framework: string | null },
): string {
  const packages = inferPackages(scenario, spec);

  return CONFIG_FILE_USER_PROMPT_TEMPLATE
    .replaceAll("{config_path}", configPath)
    .replaceAll("{config_purpose}", configPurpose)
    .replaceAll("{project_title}", scenario.scenario.title)
    .replaceAll("{runtime}", spec.runtime ?? "node")
    .replaceAll("{framework}", spec.framework ?? "none")
    .replaceAll("{packages}", packages.join(", "));
}

export function buildSourceFilePrompt(
  manifest: ManifestFile,
  context: CompressedContext,
  candidateTasks: CandidateTask[],
  packages: string[],
): string {
  // Split dependencies into local (in manifest) vs external
  const localImportLines: string[] = [];
  const externalDeps: string[] = [];

  for (const dep of manifest.dependencies) {
    const exports = context.all_exports[dep];
    if (exports) {
      const relativePath = computeRelativeImportPath(manifest.path, dep);
      localImportLines.push(`From "${relativePath}" you may import: ${exports.join(", ")}`);
    } else if (!dep.startsWith(".") && !dep.startsWith("/")) {
      externalDeps.push(dep);
    }
  }

  const allowedLocalImports = localImportLines.length > 0
    ? localImportLines.join("\n")
    : "(none — this file has no local dependencies)";

  let modeSection = "";
  let taskDetails = "";

  if (manifest.provided_or_candidate === "provided") {
    modeSection = "This is a PROVIDED file. Write a complete, fully working implementation. No TODOs, no stubs.";

    // Detect server/app entry point files and add structural requirements
    const basename = manifest.path.split("/").pop() ?? "";
    const isServerEntryPoint = /^(server|app|index)\.[jt]sx?$/.test(basename);
    if (isServerEntryPoint) {
      // Find route/router files in allowed local imports
      const routeImports = localImportLines.filter(
        (line) => /route|router|controller|endpoint/i.test(line),
      );
      modeSection += `

CRITICAL STRUCTURAL REQUIREMENTS for this server entry-point file:
1. You MUST import and mount (app.use()) ALL route/router files from the allowed local imports.${routeImports.length > 0 ? "\n   Route files to mount: " + routeImports.map(l => l.split('"')[1]).filter(Boolean).join(", ") : ""}
2. You MUST call app.listen() (or equivalent) at the bottom of the file so the server actually starts. Use a PORT variable from process.env with a sensible default (e.g., 3000).
3. You MUST export the app instance so tests can use it with supertest.
4. Middleware ordering: body parsing → CORS/helmet → route mounting → 404 catch-all → error handler.
5. The 404 handler must come AFTER all routes but BEFORE the error-handling middleware.`;
    }
  } else if (manifest.provided_or_candidate === "candidate") {
    modeSection = "This is a CANDIDATE file. Write ONLY the skeleton: imports, type signatures, and exported function/class shells with TODO comments in each body. Do NOT include any implementation logic.";
    const matchingTasks = candidateTasks.filter((t) =>
      t.target_files.includes(manifest.path),
    );
    if (matchingTasks.length > 0) {
      taskDetails = "Tasks the candidate will implement in this file:\n" +
        matchingTasks.map((t) =>
          `- ${t.title}: ${t.description}\n  Acceptance criteria: ${t.acceptance_criteria.join("; ")}`,
        ).join("\n");
    }
  } else {
    modeSection = "This is a PARTIAL file. Write working scaffolding code plus clearly marked TODO blocks (using // TODO: BEGIN and // TODO: END markers) where the candidate adds logic.";
    const matchingTasks = candidateTasks.filter((t) =>
      t.target_files.includes(manifest.path),
    );
    if (matchingTasks.length > 0) {
      taskDetails = "Tasks for the TODO sections in this file:\n" +
        matchingTasks.map((t) =>
          `- ${t.title}: ${t.description}\n  Acceptance criteria: ${t.acceptance_criteria.join("; ")}`,
        ).join("\n");
    }
  }

  return SOURCE_FILE_USER_PROMPT_TEMPLATE
    .replaceAll("{file_path}", manifest.path)
    .replaceAll("{purpose}", manifest.purpose)
    .replaceAll("{mode}", manifest.provided_or_candidate)
    .replaceAll("{mode_specific_section}", modeSection)
    .replaceAll("{project_title}", context.project_title)
    .replaceAll("{runtime}", context.runtime)
    .replaceAll("{framework}", context.framework ?? "none")
    .replaceAll("{narrative_oneliner}", context.narrative_oneliner)
    .replaceAll("{type_definitions}", context.type_definitions)
    .replaceAll("{exports}", manifest.exports.join(", "))
    .replaceAll("{allowed_local_imports}", allowedLocalImports)
    .replaceAll("{packages}", packages.join(", ") || "(none)")
    .replaceAll("{manifest_summary}", context.manifest_summary ?? "(not available)")
    .replaceAll("{task_details}", taskDetails);
}

export function buildReadmePrompt(
  scenario: ScenarioDesign,
  allFilePaths: string[],
): string {
  const readme = scenario.readme_structure;

  return README_USER_PROMPT_TEMPLATE
    .replaceAll("{project_title}", scenario.scenario.title)
    .replaceAll("{overview}", readme.overview)
    .replaceAll("{setup_steps}", readme.setup_steps.map((s) => `- ${s}`).join("\n"))
    .replaceAll("{task_descriptions}", readme.task_descriptions.map((d, i) => `${i + 1}. ${d}`).join("\n"))
    .replaceAll("{submission_instructions}", readme.submission_instructions)
    .replaceAll("{time_expectation}", readme.time_expectation)
    .replaceAll("{file_list}", allFilePaths.map((p) => `- ${p}`).join("\n"));
}

export function buildRepairPrompt(
  filePath: string,
  errors: string[],
  content: string,
): string {
  return REPAIR_PROMPT_TEMPLATE
    .replaceAll("{file_path}", filePath)
    .replaceAll("{errors}", errors.map((e) => `- ${e}`).join("\n"))
    .replaceAll("{content}", content);
}

export function inferPackages(
  scenario: ScenarioDesign,
  spec: { runtime: string | null; framework: string | null },
): string[] {
  const packages = new Set<string>();

  if (spec.framework) {
    packages.add(spec.framework);
  }

  for (const entry of scenario.starter_repo.manifest) {
    for (const dep of entry.dependencies) {
      if (!dep.startsWith(".") && !dep.startsWith("/")) {
        packages.add(dep);
      }
    }
  }

  return [...packages];
}
