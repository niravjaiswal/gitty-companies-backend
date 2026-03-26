import type { ScenarioDesign } from "../stage2/scenario-schema.js";
import type { AssessmentSpec } from "../stage1/spec-schema.js";
import type { CompressedContext } from "./build-context.js";
import { callLlm } from "../../app/external/llm/client.js";
import { buildCompressedContext, deriveTypesList } from "./build-context.js";
import {
  buildTypesFilePrompt,
  buildSecondaryTypesFilePrompt,
  buildConfigFilePrompt,
  buildSourceFilePrompt,
  buildReadmePrompt,
  buildRepairPrompt,
  inferPackages,
} from "./build-prompt.js";
import { STAGE3_SYSTEM_PROMPT } from "./prompts.js";
import { stripMarkdownFences, validateGeneratedFile, scrubInvalidImports } from "./validate-file.js";
import { withConcurrencyLimit } from "./concurrency.js";
import { derivePackageJson } from "./derive-package-json.js";
import { deriveTsConfig, deriveVitestConfig } from "./derive-configs.js";
import { runStructuralChecks } from "./structural-checks.js";

const SONNET_MODEL = "claude-sonnet-4-20250514";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export interface GenerateRepoResult {
  files: Map<string, string>;
  warnings: string[];
  failures: Array<{ path: string; errors: string[]; content: string }>;
}

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(path) || path.includes("__tests__");
}

function isTypesFile(path: string): boolean {
  // Match src/types.ts, src/types/api.ts, src/types/auth.ts, etc.
  return /types\.[jt]sx?$/.test(path) || /\/types\/[^/]+\.[jt]sx?$/.test(path);
}

/** The "primary" types file is the canonical one (src/types.ts). Others are secondary. */
function isPrimaryTypesFile(path: string): boolean {
  return /types\.[jt]sx?$/.test(path) && !/\/types\//.test(path);
}

export async function generateRepo(
  scenario: ScenarioDesign,
  spec: AssessmentSpec,
): Promise<GenerateRepoResult> {
  const files = new Map<string, string>();
  const warnings: string[] = [];
  const failures: Array<{ path: string; errors: string[]; content: string }> = [];

  const baseContext = buildCompressedContext(scenario, spec);
  const typesList = deriveTypesList(scenario);
  const allManifestPaths = new Set(scenario.starter_repo.manifest.map((m) => m.path));

  // Find ALL type files in the manifest. Generate them all in Phase 0
  // sequentially so each subsequent file knows what's already defined.
  const allTypeEntries = scenario.starter_repo.manifest.filter((m) => isTypesFile(m.path));
  const primaryTypeEntry = allTypeEntries.find((m) => isPrimaryTypesFile(m.path));
  const secondaryTypeEntries = allTypeEntries.filter((m) => !isPrimaryTypesFile(m.path));

  const typesPath = primaryTypeEntry?.path ?? "src/types.ts";
  if (!primaryTypeEntry) {
    allManifestPaths.add(typesPath);
  }

  // --- Phase 0: Types files (sequential, primary first) ---
  console.error("  Phase 0: Generating types file(s)...");

  // Generate primary types file
  const typesPrompt = buildTypesFilePrompt(baseContext, typesList);
  const typesResult = await callLlm({
    model: SONNET_MODEL,
    maxTokens: 4096,
    system: STAGE3_SYSTEM_PROMPT,
    messages: [{ role: "user", content: typesPrompt }],
    temperature: 0.2,
  });
  const typesContent = stripMarkdownFences(typesResult.content);
  files.set(typesPath, typesContent);

  // Generate secondary type files (src/types/api.ts, src/types/auth.ts, etc.)
  // Each sees the primary types content to avoid redeclaration.
  let allTypesContent = typesContent;
  for (const secondaryEntry of secondaryTypeEntries) {
    const secondaryPrompt = buildSecondaryTypesFilePrompt(
      baseContext,
      secondaryEntry,
      typesPath,
      allTypesContent,
    );
    const secondaryResult = await callLlm({
      model: SONNET_MODEL,
      maxTokens: 4096,
      system: STAGE3_SYSTEM_PROMPT,
      messages: [{ role: "user", content: secondaryPrompt }],
      temperature: 0.2,
    });
    const secondaryContent = stripMarkdownFences(secondaryResult.content);
    files.set(secondaryEntry.path, secondaryContent);
    // Accumulate so next secondary file also sees what this one defined
    allTypesContent += "\n\n// --- " + secondaryEntry.path + " ---\n" + secondaryContent;
  }

  const context: CompressedContext = {
    ...baseContext,
    type_definitions: allTypesContent,
  };

  // --- Phase 1: Config files (parallel, excluding package.json) ---
  console.error("  Phase 1: Generating config files...");

  // Separate ORM schema files (Prisma, Drizzle) from regular configs.
  // ORM schemas are effectively data-model code — they need Sonnet + full
  // context (types, manifest, provision types) to produce correct models.
  const isOrmSchemaFile = (path: string): boolean =>
    /prisma\/schema\.prisma$/.test(path) ||
    /schema\.(prisma|drizzle)\b/.test(path) ||
    /drizzle.*schema\.[jt]s$/.test(path);

  // tsconfig.json and vitest.config.ts are generated deterministically in Phase 3.5
  // (same as package.json) because LLM generation adds variance with zero benefit.
  const DETERMINISTIC_CONFIGS = new Set(["package.json", "tsconfig.json", "vitest.config.ts", "vitest.config.mts"]);

  const configTasks = scenario.starter_repo.config_files
    .filter((config) => !DETERMINISTIC_CONFIGS.has(config.path))
    .map((config) => {
    return async () => {
      if (isOrmSchemaFile(config.path)) {
        // ORM schemas need rich context to generate correct models
        const manifestSummary = scenario.starter_repo.manifest
          .map((m) => `- ${m.path} (${m.provided_or_candidate}): ${m.purpose} [exports: ${m.exports.join(", ")}]`)
          .join("\n");
        const ormPrompt = `Generate the ORM schema file at path: ${config.path}

Purpose: ${config.purpose}

Project: ${scenario.scenario.title}
Runtime: ${spec.runtime ?? "node"}
Framework: ${spec.framework ?? "none"}
Database: Use SQLite as the database provider unless the project description explicitly requires PostgreSQL or MySQL.

Shared type definitions (use these as the basis for your data models):
${typesContent}

Project file manifest (shows what models/files exist vs what candidates will implement):
${manifestSummary}

IMPORTANT:
- Only define models for entities that are referenced by PROVIDED files. Do NOT define models for entities that only appear in CANDIDATE files — those will be added by the candidate.
- If a model references another model that doesn't exist yet (candidate-only), omit that relation or use a plain ID field instead.
- Ensure the schema is self-consistent and can pass \`prisma generate\` / \`prisma validate\` without errors.

Generate a realistic, working schema file. Output ONLY the file contents.`;
        const result = await callLlm({
          model: SONNET_MODEL,
          maxTokens: 4096,
          system: STAGE3_SYSTEM_PROMPT,
          messages: [{ role: "user", content: ormPrompt }],
          temperature: 0.2,
        });
        return { path: config.path, content: stripMarkdownFences(result.content) };
      }

      const prompt = buildConfigFilePrompt(config.path, config.purpose, scenario, spec);
      const result = await callLlm({
        model: HAIKU_MODEL,
        maxTokens: 2048,
        system: STAGE3_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      });
      return { path: config.path, content: stripMarkdownFences(result.content) };
    };
  });

  const configResults = await withConcurrencyLimit(configTasks, 5);
  for (const result of configResults) {
    if (result.status === "fulfilled") {
      files.set(result.value.path, result.value.content);
    } else {
      warnings.push(`Config file generation failed: ${String(result.reason)}`);
    }
  }

  // --- Phase 2: Source files excluding tests and types (parallel) ---
  console.error("  Phase 2: Generating source files...");
  const sourceEntries = scenario.starter_repo.manifest.filter(
    (m) => !isTestFile(m.path) && !isTypesFile(m.path),
  );

  const packages = inferPackages(scenario, spec);

  const sourceResults = await generateAndValidateFiles(
    sourceEntries,
    context,
    scenario,
    packages,
    allManifestPaths,
  );

  for (const { path, content, fileWarnings, fileFailure } of sourceResults) {
    files.set(path, content);
    warnings.push(...fileWarnings);
    if (fileFailure) failures.push(fileFailure);
  }

  // --- Phase 3: Test files (parallel, with Phase 2 outputs available) ---
  const testEntries = scenario.starter_repo.manifest.filter(
    (m) => isTestFile(m.path) && !isTypesFile(m.path),
  );

  if (testEntries.length > 0) {
    console.error("  Phase 3: Generating test files...");

    const testResults = await generateAndValidateFiles(
      testEntries,
      context,
      scenario,
      packages,
      allManifestPaths,
    );

    for (const { path, content, fileWarnings, fileFailure } of testResults) {
      files.set(path, content);
      warnings.push(...fileWarnings);
      if (fileFailure) failures.push(fileFailure);
    }
  }

  // --- Phase 3.5: Deterministic configs (package.json, tsconfig, vitest) ---
  console.error("  Phase 3.5: Deriving deterministic configs...");

  const packageJsonEntry = scenario.starter_repo.config_files.find(
    (c) => c.path === "package.json",
  );
  if (packageJsonEntry) {
    const packageJson = derivePackageJson(files, scenario, spec);
    files.set("package.json", packageJson);
  }

  // tsconfig.json — deterministic from actual file paths
  const hasTsConfig = scenario.starter_repo.config_files.some(
    (c) => c.path === "tsconfig.json",
  );
  if (hasTsConfig) {
    files.set("tsconfig.json", deriveTsConfig(files));
  }

  // vitest.config.ts — deterministic, ESM-compatible, correct include patterns
  const hasVitestConfig = scenario.starter_repo.config_files.some(
    (c) => c.path === "vitest.config.ts" || c.path === "vitest.config.mts",
  );
  if (hasVitestConfig) {
    files.set("vitest.config.ts", deriveVitestConfig(files));
  }

  // --- Phase 3.75: Structural post-generation checks ---
  console.error("  Phase 3.75: Running structural checks...");
  const structuralResult = runStructuralChecks(files, scenario);
  for (const fix of structuralResult.fixes) {
    files.set(fix.path, fix.newContent);
    warnings.push(`Structural fix applied to ${fix.path}: ${fix.description}`);
  }
  warnings.push(...structuralResult.warnings);

  // --- Phase 4: README (sequential) ---
  console.error("  Phase 4: Generating README...");
  const allFilePaths = [...files.keys()].sort();
  const readmePrompt = buildReadmePrompt(scenario, allFilePaths);
  const readmeResult = await callLlm({
    model: SONNET_MODEL,
    maxTokens: 2048,
    system: STAGE3_SYSTEM_PROMPT,
    messages: [{ role: "user", content: readmePrompt }],
    temperature: 0.3,
  });
  files.set("README.md", stripMarkdownFences(readmeResult.content));

  return { files, warnings, failures };
}

type ManifestFile = ScenarioDesign["starter_repo"]["manifest"][number];

interface FileResult {
  path: string;
  content: string;
  fileWarnings: string[];
  fileFailure: { path: string; errors: string[]; content: string } | null;
}

async function generateAndValidateFiles(
  entries: ManifestFile[],
  context: CompressedContext,
  scenario: ScenarioDesign,
  packages: string[],
  allManifestPaths: Set<string>,
): Promise<FileResult[]> {
  const tasks = entries.map((entry) => {
    return async (): Promise<FileResult> => {
      const prompt = buildSourceFilePrompt(entry, context, scenario.candidate_tasks, packages);
      const result = await callLlm({
        model: SONNET_MODEL,
        maxTokens: 4096,
        system: STAGE3_SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      });

      let content = stripMarkdownFences(result.content);
      const fileWarnings: string[] = [];
      let fileFailure: FileResult["fileFailure"] = null;

      const scrubResult = scrubInvalidImports(entry.path, content, allManifestPaths);
      content = scrubResult.content;
      if (scrubResult.removedImports.length > 0) {
        fileWarnings.push(
          `${entry.path}: scrubbed invalid local imports: ${scrubResult.removedImports.join(", ")}`
        );
      }

      const validation = validateGeneratedFile(entry.path, content, entry, allManifestPaths);

      if (!validation.valid) {
        // Attempt one repair
        const repairPrompt = buildRepairPrompt(entry.path, validation.errors, content);
        const repairResult = await callLlm({
          model: SONNET_MODEL,
          maxTokens: 4096,
          system: STAGE3_SYSTEM_PROMPT,
          messages: [{ role: "user", content: repairPrompt }],
          temperature: 0.1,
        });

        content = stripMarkdownFences(repairResult.content);
        const revalidation = validateGeneratedFile(entry.path, content, entry, allManifestPaths);

        if (!revalidation.valid) {
          fileFailure = { path: entry.path, errors: revalidation.errors, content };
          fileWarnings.push(`${entry.path}: repair attempted but ${revalidation.errors.length} error(s) remain`);
        } else {
          fileWarnings.push(`${entry.path}: repaired after initial validation failure`);
        }
      }

      return { path: entry.path, content, fileWarnings, fileFailure };
    };
  });

  const results = await withConcurrencyLimit(tasks, 5);
  const fileResults: FileResult[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      fileResults.push(result.value);
    } else {
      fileResults.push({
        path: "(unknown)",
        content: "",
        fileWarnings: [`File generation failed: ${String(result.reason)}`],
        fileFailure: null,
      });
    }
  }

  return fileResults;
}

