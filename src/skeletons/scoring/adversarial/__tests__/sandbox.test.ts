import { describe, expect, it } from "vitest";
import { classifyTestModification } from "../sandbox.js";

describe("classifyTestModification", () => {
  it("returns 'none' when no test files were touched", () => {
    expect(classifyTestModification([])).toBe("none");
    expect(classifyTestModification([undefined])).toBe("none");
  });

  it("returns 'additions_only' when every prior line still appears in after", () => {
    const before = `import { it } from "vitest";
it("a", () => { expect(1).toBe(1); });`;
    const after = `import { it } from "vitest";
it("a", () => { expect(1).toBe(1); });
it("b — newly added", () => { expect(2).toBe(2); });`;

    expect(classifyTestModification([{ before, after }])).toBe("additions_only");
  });

  it("returns 'modified_existing' when a prior assertion no longer appears", () => {
    const before = `it("a", () => { expect(1).toBe(1); });`;
    const after = `it("a", () => { expect(1).toBe(2); });`;

    expect(classifyTestModification([{ before, after }])).toBe("modified_existing");
  });

  it("tolerates blank-line / leading-whitespace changes as additions", () => {
    const before = `it("x", () => {\n  expect(1).toBe(1);\n});`;
    const after = `\nit("x", () => {\n    expect(1).toBe(1);\n});\nit("y", () => { expect(2).toBe(2); });`;

    expect(classifyTestModification([{ before, after }])).toBe("additions_only");
  });

  it("escalates to 'modified_existing' if ANY touched file modifies prior lines", () => {
    const additions = {
      before: `it("x", () => { expect(1).toBe(1); });`,
      after: `it("x", () => { expect(1).toBe(1); });\nit("y", () => {});`,
    };
    const modifications = {
      before: `expect(foo).toBe(true);`,
      after: `expect(foo).toBe(false);`,
    };

    expect(classifyTestModification([additions, modifications])).toBe("modified_existing");
  });
});
