import type { GenerateRepoResult } from "../stage3/generate-repo.js";
import type { ScenarioDesign } from "../stage2/scenario-schema.js";
import type { AssessmentSpec } from "../stage1/spec-schema.js";
import { resolveImportPath } from "../stage3/validate-file.js";
import { RepoExecutor } from "./executor.js";
import { parseTscErrors, formatTscErrors } from "./parse-tsc-errors.js";
import { parseTestResults } from "./parse-test-results.js";
import {
  parseRuntimeErrors,
  runtimeErrorsToTscErrorMap,
} from "./parse-runtime-errors.js";
import { repairTscError, repairTestFailure } from "./repair.js";

export interface ValidatedRepoResult {
  files: Map<string, string>;
  validation: ValidationStepResult[];
  warnings: string[];
  overallPass: boolean;
}

export interface ValidationStepResult {
  step: "npm-install" | "tsc" | "vitest" | "tsc-recheck";
  passed: boolean;
  rounds: number;
  errors: string[];
  repairsAttempted: number;
  repairsSucceeded: number;
}

const MAX_REPAIR_ROUNDS = 2;

export async function validateRepo(
  repoResult: GenerateRepoResult,
  scenario: ScenarioDesign,
  _spec: AssessmentSpec,
): Promise<ValidatedRepoResult> {
  const warnings: string[] = [];
  const validation: ValidationStepResult[] = [];
  let overallPass = true;

  const executor = await RepoExecutor.create();

  try {
    // 1. Write all generated files to temp dir
    console.error("  Stage 4: Writing files to temp dir...");
    await executor.writeFiles(repoResult.files);

    // 2. npm install
    console.error("  Stage 4: Running npm install...");
    const npmResult = await runNpmInstall(executor, repoResult, warnings);
    validation.push(npmResult);
    if (!npmResult.passed) {
      overallPass = false;
      // Can't continue without node_modules
      const files = await executor.readAllFiles(repoResult.files.keys());
      return { files, validation, warnings, overallPass };
    }

    // 3. tsc --noEmit (max 2 rounds)
    console.error("  Stage 4: Running tsc --noEmit...");
    const tscResult = await runTscWithRepair(executor, warnings);
    validation.push(tscResult);
    if (!tscResult.passed) overallPass = false;

    // 4. vitest run (max 2 rounds)
    console.error("  Stage 4: Running vitest...");
    const vitestResult = await runVitestWithRepair(
      executor,
      scenario,
      warnings,
    );
    validation.push(vitestResult);
    if (!vitestResult.passed) overallPass = false;

    // 5. Final tsc recheck if vitest repair changed files
    if (vitestResult.repairsSucceeded > 0) {
      console.error("  Stage 4: Re-checking tsc after vitest repairs...");
      const recheckResult = await runTscRecheck(executor, warnings);
      validation.push(recheckResult);
      if (!recheckResult.passed) overallPass = false;
    }

    // 6. Read all files back from temp dir
    const files = await executor.readAllFiles(repoResult.files.keys());
    return { files, validation, warnings, overallPass };
  } finally {
    // 7. Cleanup
    await executor.cleanup();
  }
}

async function runNpmInstall(
  executor: RepoExecutor,
  repoResult: GenerateRepoResult,
  warnings: string[],
): Promise<ValidationStepResult> {
  const result: ValidationStepResult = {
    step: "npm-install",
    passed: false,
    rounds: 1,
    errors: [],
    repairsAttempted: 0,
    repairsSucceeded: 0,
  };

  const installResult = await executor.npmInstall();
  if (installResult.exitCode === 0) {
    result.passed = true;
    return result;
  }

  result.errors.push(installResult.stderr || installResult.stdout);

  // Attempt LLM repair of package.json
  const packageJsonContent = repoResult.files.get("package.json");
  if (!packageJsonContent) {
    warnings.push("npm install failed and no package.json found to repair");
    return result;
  }

  result.repairsAttempted = 1;
  try {
    const { repairTscError: repairPkgJson } = await import("./repair.js");
    const repaired = await repairPkgJson(
      "package.json",
      packageJsonContent,
      [`npm install failed: ${installResult.stderr.slice(0, 500)}`],
    );
    await executor.writeFile("package.json", repaired);

    result.rounds = 2;
    const retryResult = await executor.npmInstall();
    if (retryResult.exitCode === 0) {
      result.passed = true;
      result.repairsSucceeded = 1;
    } else {
      result.errors.push(retryResult.stderr || retryResult.stdout);
      warnings.push("npm install failed after repair attempt");
    }
  } catch (e) {
    warnings.push(`npm install repair failed: ${String(e)}`);
  }

  return result;
}

async function runTscWithRepair(
  executor: RepoExecutor,
  warnings: string[],
): Promise<ValidationStepResult> {
  const result: ValidationStepResult = {
    step: "tsc",
    passed: false,
    rounds: 0,
    errors: [],
    repairsAttempted: 0,
    repairsSucceeded: 0,
  };

  for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
    result.rounds = round + 1;
    const tscResult = await executor.tscCheck();

    if (tscResult.exitCode === 0) {
      result.passed = true;
      return result;
    }

    let errorsByFile = parseTscErrors(tscResult.stdout + "\n" + tscResult.stderr);

    if (errorsByFile.size === 0) {
      // Fallback: parse Node runtime errors from the output
      const runtimeErrors = parseRuntimeErrors(
        tscResult.stdout + "\n" + tscResult.stderr,
        executor.dir,
      );
      errorsByFile = runtimeErrorsToTscErrorMap(runtimeErrors);
    }

    if (errorsByFile.size === 0) {
      // Catch-all: no parser could extract structured errors.
      const rawOutput = (tscResult.stderr || tscResult.stdout).slice(0, 2000);
      result.errors.push(`Unparseable tsc output: ${rawOutput}`);
      warnings.push("tsc failed with unparseable output");
      return result;
    }

    // Last round — just log remaining errors, don't repair
    if (round === MAX_REPAIR_ROUNDS - 1) {
      for (const [file, errors] of errorsByFile) {
        const formatted = formatTscErrors(errors);
        result.errors.push(`${file}: ${formatted.join("; ")}`);
      }
      warnings.push(
        `tsc: ${errorsByFile.size} file(s) still have errors after ${MAX_REPAIR_ROUNDS} rounds`,
      );
      return result;
    }

    // Repair each failing file
    for (const [file, errors] of errorsByFile) {
      result.repairsAttempted++;
      try {
        const content = await executor.readFile(file);
        const formatted = formatTscErrors(errors);
        const repaired = await repairTscError(file, content, formatted);
        await executor.writeFile(file, repaired);
        result.repairsSucceeded++;
      } catch (e) {
        warnings.push(`tsc repair failed for ${file}: ${String(e)}`);
      }
    }
  }

  return result;
}

async function runVitestWithRepair(
  executor: RepoExecutor,
  scenario: ScenarioDesign,
  warnings: string[],
): Promise<ValidationStepResult> {
  const result: ValidationStepResult = {
    step: "vitest",
    passed: false,
    rounds: 0,
    errors: [],
    repairsAttempted: 0,
    repairsSucceeded: 0,
  };

  // Build set of candidate/partial file paths for expected-failure classification
  const candidateOrPartialPaths = new Set(
    scenario.starter_repo.manifest
      .filter((m) => m.provided_or_candidate !== "provided")
      .map((m) => m.path.replace(/\.[jt]sx?$/, "")),
  );

  for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
    result.rounds = round + 1;
    const vitestResult = await executor.vitestRun();

    // vitest returns exit code 0 on all tests passing
    if (vitestResult.exitCode === 0) {
      result.passed = true;
      return result;
    }

    let testResults;
    try {
      testResults = parseTestResults(vitestResult.stdout);
    } catch {
      // vitest crashed before producing JSON — try to extract runtime errors
      const combinedOutput = vitestResult.stdout + "\n" + vitestResult.stderr;
      const runtimeErrors = parseRuntimeErrors(combinedOutput, executor.dir);

      if (runtimeErrors.length > 0 && round < MAX_REPAIR_ROUNDS - 1) {
        for (const re of runtimeErrors) {
          result.repairsAttempted++;
          try {
            const content = await executor.readFile(re.file);
            const repaired = await repairTscError(re.file, content, [
              re.message,
            ]);
            await executor.writeFile(re.file, repaired);
            result.repairsSucceeded++;
          } catch (e) {
            warnings.push(
              `vitest crash repair failed for ${re.file}: ${String(e)}`,
            );
          }
        }
        continue; // re-run vitest in next loop iteration
      }

      // Catch-all: include raw output
      const rawOutput = (vitestResult.stderr || vitestResult.stdout).slice(
        0,
        2000,
      );
      result.errors.push(`Unparseable vitest output: ${rawOutput}`);
      warnings.push("vitest crashed with unparseable output");
      return result;
    }

    const failingFiles = testResults.filter((t) => !t.passed);
    if (failingFiles.length === 0) {
      // All parsed tests passed but exit code was non-zero — might be config issue
      result.passed = true;
      return result;
    }

    // Classify failures
    const unexpectedFailures = failingFiles.filter((tf) => {
      return !isExpectedFailure(tf.filePath, executor.dir, candidateOrPartialPaths);
    });

    if (unexpectedFailures.length === 0) {
      // All failures are expected (tests for candidate/partial files)
      result.passed = true;
      warnings.push(
        `vitest: ${failingFiles.length} test file(s) failed as expected (candidate/partial imports)`,
      );
      return result;
    }

    // Last round — log remaining errors
    if (round === MAX_REPAIR_ROUNDS - 1) {
      for (const tf of unexpectedFailures) {
        for (const f of tf.failures) {
          result.errors.push(`${tf.filePath}: ${f.testName} — ${f.message.slice(0, 200)}`);
        }
      }
      warnings.push(
        `vitest: ${unexpectedFailures.length} test file(s) still failing after ${MAX_REPAIR_ROUNDS} rounds`,
      );
      return result;
    }

    // Repair: fix the implementation file, not the test
    for (const tf of unexpectedFailures) {
      const implPath = findImplFile(tf.filePath, executor.dir, scenario);
      if (!implPath) {
        warnings.push(`vitest: could not determine impl file for test ${tf.filePath}`);
        continue;
      }

      result.repairsAttempted++;
      try {
        const implContent = await executor.readFile(implPath);
        const testContent = await executor.readFile(
          stripBasePath(tf.filePath, executor.dir),
        );
        const failureMessages = tf.failures.map(
          (f) => `${f.testName}: ${f.message.slice(0, 300)}`,
        );
        const repaired = await repairTestFailure(
          implPath,
          implContent,
          stripBasePath(tf.filePath, executor.dir),
          testContent,
          failureMessages,
        );
        await executor.writeFile(implPath, repaired);
        result.repairsSucceeded++;
      } catch (e) {
        warnings.push(`vitest repair failed for ${tf.filePath}: ${String(e)}`);
      }
    }
  }

  return result;
}

async function runTscRecheck(
  executor: RepoExecutor,
  warnings: string[],
): Promise<ValidationStepResult> {
  const result: ValidationStepResult = {
    step: "tsc-recheck",
    passed: false,
    rounds: 1,
    errors: [],
    repairsAttempted: 0,
    repairsSucceeded: 0,
  };

  const tscResult = await executor.tscCheck();
  if (tscResult.exitCode === 0) {
    result.passed = true;
  } else {
    let errorsByFile = parseTscErrors(tscResult.stdout + "\n" + tscResult.stderr);
    if (errorsByFile.size === 0 && tscResult.exitCode !== 0) {
      const runtimeErrors = parseRuntimeErrors(
        tscResult.stdout + "\n" + tscResult.stderr,
        executor.dir,
      );
      errorsByFile = runtimeErrorsToTscErrorMap(runtimeErrors);
    }
    for (const [file, errors] of errorsByFile) {
      const formatted = formatTscErrors(errors);
      result.errors.push(`${file}: ${formatted.join("; ")}`);
    }
    if (errorsByFile.size === 0 && tscResult.exitCode !== 0) {
      result.errors.push(
        (tscResult.stderr || tscResult.stdout).slice(0, 2000),
      );
    }
    warnings.push("tsc-recheck failed after vitest repairs");
  }

  return result;
}

/**
 * Determine if a test file's failures are "expected" because it imports
 * candidate/partial files (which are intentional stubs).
 */
function isExpectedFailure(
  testFilePath: string,
  baseDir: string,
  candidateOrPartialPaths: Set<string>,
): boolean {
  const relative = stripBasePath(testFilePath, baseDir);
  const testDir = relative.includes("/")
    ? relative.substring(0, relative.lastIndexOf("/"))
    : ".";

  // Check if the test file imports any candidate/partial file by naming convention
  // Test file: src/__tests__/foo.test.ts likely tests src/foo.ts
  // Test file: src/foo.test.ts likely tests src/foo.ts
  const baseName = relative
    .replace(/\.[jt]sx?$/, "")
    .replace(/\.(test|spec)$/, "")
    .replace(/__tests__\//, "");

  return candidateOrPartialPaths.has(baseName);
}

/**
 * Find the implementation file that a test file is testing.
 * Uses import analysis from the manifest + naming convention fallback.
 */
function findImplFile(
  testFilePath: string,
  baseDir: string,
  scenario: ScenarioDesign,
): string | null {
  const relative = stripBasePath(testFilePath, baseDir);

  // Strategy 1: Check manifest's tests_for mapping
  for (const task of scenario.candidate_tasks) {
    if (task.tests_for.some((t) => relative.endsWith(t) || t.endsWith(relative))) {
      // Return the first target_file as the impl file
      if (task.target_files.length > 0) {
        return task.target_files[0];
      }
    }
  }

  // Strategy 2: Naming convention
  // src/__tests__/foo.test.ts → src/foo.ts
  // src/foo.test.ts → src/foo.ts
  const withoutExt = relative.replace(/\.[jt]sx?$/, "");
  const withoutTestSuffix = withoutExt.replace(/\.(test|spec)$/, "");
  const withoutTestDir = withoutTestSuffix.replace(/__tests__\//, "");

  // Try common extensions
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const candidate = withoutTestDir + ext;
    const manifestEntry = scenario.starter_repo.manifest.find(
      (m) => m.path === candidate,
    );
    if (manifestEntry) return candidate;
  }

  // Strategy 3: Check manifest dependencies
  const testEntry = scenario.starter_repo.manifest.find(
    (m) => m.path === relative,
  );
  if (testEntry && testEntry.dependencies.length > 0) {
    // Return the first dependency that's a provided file
    for (const dep of testEntry.dependencies) {
      const depEntry = scenario.starter_repo.manifest.find(
        (m) => m.path === dep,
      );
      if (depEntry && depEntry.provided_or_candidate === "provided") {
        return dep;
      }
    }
    // Fallback: return first dependency
    return testEntry.dependencies[0];
  }

  return null;
}

function stripBasePath(fullPath: string, baseDir: string): string {
  const prefix = baseDir.endsWith("/") ? baseDir : baseDir + "/";
  if (fullPath.startsWith(prefix)) {
    return fullPath.slice(prefix.length);
  }
  return fullPath;
}
