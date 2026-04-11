import {
  RepoExecutor,
  parseTscErrors,
  formatTscErrors,
  parseTestResults,
  repairTscError,
  repairTestFailure,
} from "../validation/index.js";
import type { Manifest } from "../skeletons/types.js";
import type { RemixedWorkspace, ValidationReport } from "./types.js";

/**
 * Validate a remixed workspace by running npm install, tsc, and vitest.
 *
 * Lighter than the full pipeline validation:
 *  - 1 repair round (not 2) — the skeleton baseline is known-good
 *  - npm install is never repaired (package.json is adapt: false)
 *  - Only adapt-true files are repair targets
 */
export async function validateRemix(
  workspace: RemixedWorkspace,
  manifest: Manifest,
  options?: { maxRepairRounds?: number },
): Promise<ValidationReport> {
  const maxRepairRounds = options?.maxRepairRounds ?? 1;
  const adaptPaths = new Set(
    manifest.files.filter((f) => f.adapt).map((f) => f.path),
  );

  const executor = await RepoExecutor.create();
  const errors: string[] = [];
  let repairRounds = 0;

  try {
    // Write all files to temp directory
    const fileMap = new Map(Object.entries(workspace.files));
    await executor.writeFiles(fileMap);

    // ── npm install ────────────────────────────────────────────
    const installResult = await executor.npmInstall();
    if (installResult.exitCode !== 0) {
      errors.push(`npm install failed: ${installResult.stderr.slice(0, 500)}`);
      return { tscPass: false, vitestPass: false, overallPass: false, repairRounds, errors };
    }

    // ── tsc check ──────���───────────────────────────────────────
    let tscResult = await executor.tscCheck();
    let tscPass = tscResult.exitCode === 0;

    if (!tscPass && repairRounds < maxRepairRounds) {
      const tscErrors = parseTscErrors(tscResult.stdout || tscResult.stderr);

      // Only repair adapt-true files
      let repaired = false;
      for (const [filePath, fileErrors] of tscErrors) {
        if (!adaptPaths.has(filePath)) {
          errors.push(`tsc error in static file ${filePath} — cannot repair`);
          continue;
        }

        const content = await executor.readFile(filePath);
        const errorMessages = formatTscErrors(fileErrors);
        const fixed = await repairTscError(filePath, content, errorMessages);
        await executor.writeFile(filePath, fixed);
        repaired = true;
      }

      if (repaired) {
        repairRounds++;
        tscResult = await executor.tscCheck();
        tscPass = tscResult.exitCode === 0;
      }
    }

    if (!tscPass) {
      const remaining = parseTscErrors(tscResult.stdout || tscResult.stderr);
      for (const [filePath, fileErrors] of remaining) {
        for (const e of fileErrors) {
          errors.push(`${filePath}(${e.line},${e.column}): ${e.code}: ${e.message}`);
        }
      }
    }

    // ── vitest ───────���─────────────────────────────────────────
    let vitestResult = await executor.vitestRun();
    let vitestPass = vitestResult.exitCode === 0;

    if (!vitestPass && repairRounds < maxRepairRounds) {
      try {
        const testResults = parseTestResults(vitestResult.stdout);
        let repaired = false;

        for (const fileResult of testResults) {
          if (fileResult.passed) continue;

          // Find the implementation file to repair (not the test file).
          // Test files test adapt-true implementation files — repair the impl.
          const failureMessages = fileResult.failures.map((f) => f.message);

          // Look for the corresponding adapt-true source file.
          // Convention: test file tests the non-test file in the same directory
          // or the file it imports. We repair all adapt-true files that have tsc
          // errors or are likely related to the failing tests.
          for (const adaptPath of adaptPaths) {
            // Skip test files themselves — we repair implementations
            if (adaptPath.includes(".test.") || adaptPath.includes("__tests__")) continue;

            const implContent = await executor.readFile(adaptPath);
            const testContent = await executor.readFile(fileResult.filePath.replace(executor.dir + "/", ""));
            const fixed = await repairTestFailure(
              adaptPath,
              implContent,
              fileResult.filePath.replace(executor.dir + "/", ""),
              testContent,
              failureMessages,
            );
            if (fixed !== implContent) {
              await executor.writeFile(adaptPath, fixed);
              repaired = true;
            }
          }
        }

        if (repaired) {
          repairRounds++;
          // Re-check tsc after test repairs
          const recheckTsc = await executor.tscCheck();
          if (recheckTsc.exitCode !== 0) {
            tscPass = false;
          }
          vitestResult = await executor.vitestRun();
          vitestPass = vitestResult.exitCode === 0;
        }
      } catch {
        errors.push("Failed to parse vitest output for repair");
      }
    }

    if (!vitestPass) {
      try {
        const testResults = parseTestResults(vitestResult.stdout);
        for (const fileResult of testResults) {
          for (const failure of fileResult.failures) {
            errors.push(`${failure.testName}: ${failure.message.slice(0, 200)}`);
          }
        }
      } catch {
        errors.push(`vitest failed with exit code ${vitestResult.exitCode}`);
      }
    }

    return {
      tscPass,
      vitestPass,
      overallPass: tscPass && vitestPass,
      repairRounds,
      errors,
    };
  } finally {
    await executor.cleanup();
  }
}
