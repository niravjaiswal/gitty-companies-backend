import type { ScenarioDesign } from "../stage2/scenario-schema.js";
import type { AssessmentSpec } from "../stage1/spec-schema.js";
import type { CompressedContext } from "./build-context.js";
import { callLlm } from "../../app/external/llm/client.js";
import { buildCompressedContext, deriveTypesList } from "./build-context.js";
import {
  buildTypesFilePrompt,
  buildConfigFilePrompt,
  buildSourceFilePrompt,
  buildReadmePrompt,
  buildRepairPrompt,
  inferPackages,
} from "./build-prompt.js";
import { STAGE3_SYSTEM_PROMPT } from "./prompts.js";
import { stripMarkdownFences, validateGeneratedFile } from "./validate-file.js";
import { withConcurrencyLimit } from "./concurrency.js";

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
  return /types\.[jt]s$/.test(path);
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

  // Find the types file entry; if none exists in manifest, use a default and register it
  const typesEntry = scenario.starter_repo.manifest.find((m) => isTypesFile(m.path));
  const typesPath = typesEntry?.path ?? "src/types.ts";
  if (!typesEntry) {
    allManifestPaths.add(typesPath);
  }

  // --- Phase 0: Types file (sequential) ---
  console.error("  Phase 0: Generating types file...");
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

  const context: CompressedContext = {
    ...baseContext,
    type_definitions: typesContent,
  };

  // --- Phase 1: Config files (parallel) ---
  console.error("  Phase 1: Generating config files...");
  const configTasks = scenario.starter_repo.config_files.map((config) => {
    return async () => {
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

