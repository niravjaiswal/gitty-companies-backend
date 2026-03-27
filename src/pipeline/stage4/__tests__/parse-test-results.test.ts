import { describe, it, expect } from "vitest";
import { parseTestResults } from "../parse-test-results.js";

function makeVitestJson(testResults: object[]): string {
  return JSON.stringify({
    success: testResults.every(
      (t) => (t as Record<string, unknown>).status !== "failed",
    ),
    numTotalTests: 0,
    numPassedTests: 0,
    numFailedTests: 0,
    testResults,
  });
}

describe("parseTestResults", () => {
  it("parses all-passing results", () => {
    const json = makeVitestJson([
      {
        name: "/tmp/project/src/__tests__/utils.test.ts",
        status: "passed",
        assertionResults: [
          {
            ancestorTitles: ["utils"],
            fullName: "utils > adds numbers",
            status: "passed",
            title: "adds numbers",
            failureMessages: [],
          },
        ],
      },
    ]);

    const results = parseTestResults(json);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
    expect(results[0].numPassing).toBe(1);
    expect(results[0].numFailing).toBe(0);
    expect(results[0].failures).toEqual([]);
  });

  it("parses failing test results", () => {
    const json = makeVitestJson([
      {
        name: "/tmp/project/src/__tests__/math.test.ts",
        status: "failed",
        assertionResults: [
          {
            ancestorTitles: ["math"],
            fullName: "math > multiply",
            status: "passed",
            title: "multiply",
            failureMessages: [],
          },
          {
            ancestorTitles: ["math"],
            fullName: "math > divide",
            status: "failed",
            title: "divide",
            failureMessages: ["Error: expected 5 but got 0"],
          },
        ],
      },
    ]);

    const results = parseTestResults(json);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].numPassing).toBe(1);
    expect(results[0].numFailing).toBe(1);
    expect(results[0].failures).toEqual([
      {
        testName: "math > divide",
        message: "Error: expected 5 but got 0",
      },
    ]);
  });

  it("handles multiple test files", () => {
    const json = makeVitestJson([
      {
        name: "/tmp/project/src/a.test.ts",
        status: "passed",
        assertionResults: [
          {
            ancestorTitles: [],
            fullName: "test a",
            status: "passed",
            title: "test a",
            failureMessages: [],
          },
        ],
      },
      {
        name: "/tmp/project/src/b.test.ts",
        status: "failed",
        assertionResults: [
          {
            ancestorTitles: [],
            fullName: "test b",
            status: "failed",
            title: "test b",
            failureMessages: ["AssertionError: false !== true"],
          },
        ],
      },
    ]);

    const results = parseTestResults(json);
    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
  });

  it("extracts JSON from output with extra lines before it", () => {
    const prefix = "stdout | some vitest output\nmore lines\n";
    const json = makeVitestJson([
      {
        name: "test.ts",
        status: "passed",
        assertionResults: [],
      },
    ]);
    const output = prefix + json;

    const results = parseTestResults(output);
    expect(results).toHaveLength(1);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseTestResults("not json at all")).toThrow(
      "No JSON object found",
    );
  });

  it("handles multiple failure messages", () => {
    const json = makeVitestJson([
      {
        name: "test.ts",
        status: "failed",
        assertionResults: [
          {
            ancestorTitles: [],
            fullName: "broken test",
            status: "failed",
            title: "broken test",
            failureMessages: ["Error: first", "Error: second"],
          },
        ],
      },
    ]);

    const results = parseTestResults(json);
    expect(results[0].failures[0].message).toBe("Error: first\nError: second");
  });
});
