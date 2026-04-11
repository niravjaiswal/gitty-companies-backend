/**
 * Parses `vitest run --reporter=json` output into structured results.
 *
 * Vitest JSON reporter outputs a JSON object with testResults array.
 */

export interface TestFileResult {
  filePath: string;
  passed: boolean;
  numPassing: number;
  numFailing: number;
  failures: TestFailure[];
}

export interface TestFailure {
  testName: string;
  message: string;
}

export interface VitestJsonOutput {
  success: boolean;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: VitestTestResult[];
}

interface VitestTestResult {
  name: string;
  status: string;
  assertionResults: VitestAssertionResult[];
}

interface VitestAssertionResult {
  ancestorTitles: string[];
  fullName: string;
  status: string;
  title: string;
  failureMessages: string[];
}

export function parseTestResults(jsonOutput: string): TestFileResult[] {
  const raw = extractJson(jsonOutput);
  const parsed = JSON.parse(raw) as VitestJsonOutput;
  const results: TestFileResult[] = [];

  for (const testResult of parsed.testResults) {
    const failures: TestFailure[] = [];
    let numPassing = 0;
    let numFailing = 0;

    for (const assertion of testResult.assertionResults) {
      if (assertion.status === "passed") {
        numPassing++;
      } else if (assertion.status === "failed") {
        numFailing++;
        failures.push({
          testName: assertion.fullName,
          message: assertion.failureMessages.join("\n"),
        });
      }
    }

    results.push({
      filePath: testResult.name,
      passed: numFailing === 0,
      numPassing,
      numFailing,
      failures,
    });
  }

  return results;
}

/**
 * Extract the JSON object from vitest output which may contain
 * non-JSON lines before/after the actual JSON.
 */
function extractJson(output: string): string {
  // Vitest may print extra lines before the JSON. Find the first `{`.
  const start = output.indexOf("{");
  if (start === -1) {
    throw new Error("No JSON object found in vitest output");
  }

  // Find the matching closing brace by counting braces
  let depth = 0;
  for (let i = start; i < output.length; i++) {
    if (output[i] === "{") depth++;
    else if (output[i] === "}") depth--;
    if (depth === 0) {
      return output.slice(start, i + 1);
    }
  }

  throw new Error("Unbalanced braces in vitest JSON output");
}
