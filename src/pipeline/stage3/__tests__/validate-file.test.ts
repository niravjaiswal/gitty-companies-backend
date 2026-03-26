import { describe, it, expect } from "vitest";
import {
  stripMarkdownFences,
  validateGeneratedFile,
  scrubInvalidImports,
} from "../validate-file.js";

type ManifestFile = {
  path: string;
  purpose: string;
  provided_or_candidate: "provided" | "candidate" | "partial";
  dependencies: string[];
  exports: string[];
};

function makeManifest(
  overrides: Partial<ManifestFile> & { path: string },
): ManifestFile {
  return {
    purpose: "Utility module",
    provided_or_candidate: "provided",
    dependencies: [],
    exports: [],
    ...overrides,
  };
}

describe("stripMarkdownFences", () => {
  it("strips ```typescript wrapper", () => {
    const input = "```typescript\nconst x = 1;\n```";
    expect(stripMarkdownFences(input)).toBe("const x = 1;");
  });

  it("strips ```json wrapper", () => {
    const input = '```json\n{"key": "value"}\n```';
    expect(stripMarkdownFences(input)).toBe('{"key": "value"}');
  });

  it("strips plain ``` wrapper", () => {
    const input = "```\nsome content\n```";
    expect(stripMarkdownFences(input)).toBe("some content");
  });

  it("returns content unchanged if no fences", () => {
    const input = "const x = 1;\nexport default x;";
    expect(stripMarkdownFences(input)).toBe(input);
  });

  it("handles empty string", () => {
    expect(stripMarkdownFences("")).toBe("");
  });
});

describe("validateGeneratedFile", () => {
  const defaultPaths = new Set(["src/utils.ts", "src/index.ts"]);

  it("valid provided file passes", () => {
    const manifest = makeManifest({
      path: "src/utils.ts",
      provided_or_candidate: "provided",
      exports: ["helperFn"],
    });
    const content = 'export function helperFn() { return 42; }\n';
    const result = validateGeneratedFile(
      "src/utils.ts",
      content,
      manifest,
      defaultPaths,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("empty content after stripping fails", () => {
    const manifest = makeManifest({
      path: "src/utils.ts",
    });
    const content = "```typescript\n   \n```";
    const result = validateGeneratedFile(
      "src/utils.ts",
      content,
      manifest,
      defaultPaths,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "File content is empty after stripping fences.",
    );
  });

  it("missing exports detected", () => {
    const manifest = makeManifest({
      path: "src/utils.ts",
      exports: ["fooExport", "barExport"],
    });
    const content = "export function barExport() {}";
    const result = validateGeneratedFile(
      "src/utils.ts",
      content,
      manifest,
      defaultPaths,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing expected export: "fooExport"');
    expect(result.errors).not.toContain(
      'Missing expected export: "barExport"',
    );
  });

  it("invalid relative import paths detected", () => {
    const manifest = makeManifest({
      path: "src/index.ts",
    });
    const content =
      'import { something } from "./nonexistent.js";\nexport const x = 1;';
    const result = validateGeneratedFile(
      "src/index.ts",
      content,
      manifest,
      defaultPaths,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Import "\.\/nonexistent\.js"/);
    expect(result.errors[0]).toMatch(/not in the manifest/);
  });

  it("external (non-relative) imports are allowed", () => {
    const manifest = makeManifest({
      path: "src/index.ts",
    });
    const content =
      'import express from "express";\nimport { z } from "zod";\nexport const app = express();';
    const result = validateGeneratedFile(
      "src/index.ts",
      content,
      manifest,
      defaultPaths,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("candidate file without TODO fails", () => {
    const manifest = makeManifest({
      path: "src/utils.ts",
      provided_or_candidate: "candidate",
    });
    const content = "export function solve() {\n  return 42;\n}";
    const result = validateGeneratedFile(
      "src/utils.ts",
      content,
      manifest,
      defaultPaths,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Candidate file must contain at least one TODO marker.",
    );
  });

  it("candidate file over 80 lines fails", () => {
    const manifest = makeManifest({
      path: "src/utils.ts",
      provided_or_candidate: "candidate",
    });
    const lines = ["// TODO: implement"];
    for (let i = 0; i < 81; i++) {
      lines.push(`const line${i} = ${i};`);
    }
    const content = lines.join("\n");
    const result = validateGeneratedFile(
      "src/utils.ts",
      content,
      manifest,
      defaultPaths,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("expected under 80"),
      ]),
    );
  });

  it("candidate file with TODO and under 80 lines passes", () => {
    const manifest = makeManifest({
      path: "src/utils.ts",
      provided_or_candidate: "candidate",
    });
    const content =
      "export function solve(): number {\n  // TODO: implement the solution\n  return 0;\n}";
    const result = validateGeneratedFile(
      "src/utils.ts",
      content,
      manifest,
      defaultPaths,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("partial file without TODO fails", () => {
    const manifest = makeManifest({
      path: "src/utils.ts",
      provided_or_candidate: "partial",
    });
    const content = [
      "export function a() { return 1; }",
      "export function b() { return 2; }",
      "export function c() { return 3; }",
      "export function d() { return 4; }",
      "export function e() { return 5; }",
    ].join("\n");
    const result = validateGeneratedFile(
      "src/utils.ts",
      content,
      manifest,
      defaultPaths,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Partial file must contain TODO markers for candidate sections.",
    );
  });

  it("partial file with fewer than 5 substantive lines fails", () => {
    const manifest = makeManifest({
      path: "src/utils.ts",
      provided_or_candidate: "partial",
    });
    const content = [
      "// a comment",
      "// another comment",
      "// TODO: implement this",
      "export const x = 1;",
      "",
      "",
    ].join("\n");
    const result = validateGeneratedFile(
      "src/utils.ts",
      content,
      manifest,
      defaultPaths,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Partial file must contain at least 5 substantive non-comment, non-TODO lines.",
    );
  });

  it("partial file with TODO and enough substantive code passes", () => {
    const manifest = makeManifest({
      path: "src/utils.ts",
      provided_or_candidate: "partial",
    });
    const content = [
      "import { z } from 'zod';",
      "",
      "export const schema = z.object({",
      "  name: z.string(),",
      "  age: z.number(),",
      "});",
      "",
      "// TODO: implement the validation function",
      "export function validate(input: unknown) {",
      "  return schema.parse(input);",
      "}",
    ].join("\n");
    const result = validateGeneratedFile(
      "src/utils.ts",
      content,
      manifest,
      defaultPaths,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("invalid CJS require paths detected", () => {
    const manifest = makeManifest({
      path: "src/index.ts",
    });
    const content =
      'const routes = require("./nonexistent");\nexport const x = 1;';
    const result = validateGeneratedFile(
      "src/index.ts",
      content,
      manifest,
      defaultPaths,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Require "\.\/nonexistent"/);
    expect(result.errors[0]).toMatch(/not in the manifest/);
  });

  it("valid CJS require paths pass", () => {
    const manifest = makeManifest({
      path: "src/index.ts",
    });
    const content =
      'const utils = require("./utils");\nexport const x = 1;';
    const result = validateGeneratedFile(
      "src/index.ts",
      content,
      manifest,
      defaultPaths,
    );
    expect(result.valid).toBe(true);
  });

  it("external CJS requires are allowed", () => {
    const manifest = makeManifest({
      path: "src/index.ts",
    });
    const content =
      'const express = require("express");\nexport const app = express();';
    const result = validateGeneratedFile(
      "src/index.ts",
      content,
      manifest,
      defaultPaths,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scrubInvalidImports
// ---------------------------------------------------------------------------

describe("scrubInvalidImports", () => {
  const manifestPaths = new Set(["src/utils.ts", "src/index.ts", "src/db.ts"]);

  it("removes CJS require of non-manifest local file", () => {
    const content = 'const x = require("./nonexistent");\nconst y = 1;';
    const result = scrubInvalidImports("src/index.ts", content, manifestPaths);
    expect(result.content).toBe("const y = 1;");
    expect(result.removedImports).toEqual(["./nonexistent"]);
  });

  it("removes ESM import of non-manifest local file", () => {
    const content = 'import { X } from "./nonexistent";\nconst y = 1;';
    const result = scrubInvalidImports("src/index.ts", content, manifestPaths);
    expect(result.content).toBe("const y = 1;");
    expect(result.removedImports).toEqual(["./nonexistent"]);
  });

  it("removes multi-line ESM import of non-manifest local file", () => {
    const content = [
      'import {',
      '  Foo,',
      '  Bar,',
      '} from "./nonexistent";',
      'const y = 1;',
    ].join("\n");
    const result = scrubInvalidImports("src/index.ts", content, manifestPaths);
    expect(result.content).toBe("const y = 1;");
    expect(result.removedImports).toEqual(["./nonexistent"]);
  });

  it("removes side-effect import of non-manifest local file", () => {
    const content = 'import "./nonexistent";\nconst y = 1;';
    const result = scrubInvalidImports("src/index.ts", content, manifestPaths);
    expect(result.content).toBe("const y = 1;");
    expect(result.removedImports).toEqual(["./nonexistent"]);
  });

  it("preserves valid local imports", () => {
    const content = 'import { getDb } from "./db";\nconst y = 1;';
    const result = scrubInvalidImports("src/index.ts", content, manifestPaths);
    expect(result.content).toBe('import { getDb } from "./db";\nconst y = 1;');
    expect(result.removedImports).toEqual([]);
  });

  it("preserves external imports", () => {
    const content = 'import express from "express";\nconst app = express();';
    const result = scrubInvalidImports("src/index.ts", content, manifestPaths);
    expect(result.content).toBe(content);
    expect(result.removedImports).toEqual([]);
  });

  it("preserves external CJS requires", () => {
    const content = 'const express = require("express");\nconst app = express();';
    const result = scrubInvalidImports("src/index.ts", content, manifestPaths);
    expect(result.content).toBe(content);
    expect(result.removedImports).toEqual([]);
  });

  it("returns correct removedImports array for multiple scrubbed imports", () => {
    const content = [
      'import { X } from "./nonexistent";',
      'const routes = require("./fake-routes");',
      'import { getDb } from "./db";',
      'const y = 1;',
    ].join("\n");
    const result = scrubInvalidImports("src/index.ts", content, manifestPaths);
    expect(result.content).toBe('import { getDb } from "./db";\nconst y = 1;');
    expect(result.removedImports).toEqual(["./nonexistent", "./fake-routes"]);
  });
});
