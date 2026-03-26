import { describe, it, expect } from "vitest";
import { parseTscErrors, formatTscErrors } from "../parse-tsc-errors.js";

describe("parseTscErrors", () => {
  it("parses a single error", () => {
    const output = `src/index.ts(3,10): error TS2305: Module '"./types"' has no exported member 'Foo'.`;
    const result = parseTscErrors(output);

    expect(result.size).toBe(1);
    const errors = result.get("src/index.ts")!;
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      file: "src/index.ts",
      line: 3,
      column: 10,
      code: "TS2305",
      message: `Module '"./types"' has no exported member 'Foo'.`,
    });
  });

  it("groups errors by file", () => {
    const output = [
      `src/index.ts(3,10): error TS2305: Module '"./types"' has no exported member 'Foo'.`,
      `src/index.ts(7,5): error TS2322: Type 'string' is not assignable to type 'number'.`,
      `src/utils.ts(1,1): error TS2304: Cannot find name 'x'.`,
    ].join("\n");

    const result = parseTscErrors(output);

    expect(result.size).toBe(2);
    expect(result.get("src/index.ts")).toHaveLength(2);
    expect(result.get("src/utils.ts")).toHaveLength(1);
  });

  it("ignores non-error lines", () => {
    const output = [
      "Found 2 errors.",
      "",
      `src/index.ts(3,10): error TS2305: Module '"./types"' has no exported member 'Foo'.`,
      "Some random output",
    ].join("\n");

    const result = parseTscErrors(output);
    expect(result.size).toBe(1);
    expect(result.get("src/index.ts")).toHaveLength(1);
  });

  it("returns empty map for clean output", () => {
    const result = parseTscErrors("");
    expect(result.size).toBe(0);
  });

  it("returns empty map for output with no errors", () => {
    const result = parseTscErrors("Found 0 errors.\n");
    expect(result.size).toBe(0);
  });

  it("handles Windows-style paths", () => {
    const output = `src\\utils\\helper.ts(10,3): error TS2345: Argument of type 'string' is not assignable.`;
    const result = parseTscErrors(output);
    expect(result.size).toBe(1);
    expect(result.has("src\\utils\\helper.ts")).toBe(true);
  });
});

describe("formatTscErrors", () => {
  it("formats errors as readable strings", () => {
    const errors = [
      {
        file: "src/index.ts",
        line: 3,
        column: 10,
        code: "TS2305",
        message: "Module has no exported member 'Foo'.",
      },
    ];
    const formatted = formatTscErrors(errors);
    expect(formatted).toEqual(["(3,10): TS2305: Module has no exported member 'Foo'."]);
  });

  it("returns empty array for no errors", () => {
    expect(formatTscErrors([])).toEqual([]);
  });
});
