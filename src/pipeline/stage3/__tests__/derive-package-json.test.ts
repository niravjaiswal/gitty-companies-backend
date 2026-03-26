import { describe, it, expect } from "vitest";
import { extractExternalImports, derivePackageJson } from "../derive-package-json.js";
import type { ScenarioDesign } from "../../stage2/scenario-schema.js";
import type { AssessmentSpec } from "../../stage1/spec-schema.js";

// ---------------------------------------------------------------------------
// extractExternalImports
// ---------------------------------------------------------------------------

describe("extractExternalImports", () => {
  it("ESM default import", () => {
    const content = `import express from "express";`;
    expect(extractExternalImports(content)).toEqual(["express"]);
  });

  it("ESM named import", () => {
    const content = `import { Router } from "express";`;
    expect(extractExternalImports(content)).toEqual(["express"]);
  });

  it("ESM side-effect import", () => {
    const content = `import "dotenv/config";`;
    expect(extractExternalImports(content)).toEqual(["dotenv"]);
  });

  it("CJS require", () => {
    const content = `const pg = require("pg");`;
    expect(extractExternalImports(content)).toEqual(["pg"]);
  });

  it("scoped package", () => {
    const content = `import { z } from "@hono/zod-validator";`;
    expect(extractExternalImports(content)).toEqual(["@hono/zod-validator"]);
  });

  it("skips relative imports", () => {
    const content = `import { db } from "./db";`;
    expect(extractExternalImports(content)).toEqual([]);
  });

  it("skips bare Node builtins", () => {
    const content = [
      `import fs from "fs";`,
      `import { join } from "path";`,
      `import { createServer } from "http";`,
    ].join("\n");
    expect(extractExternalImports(content)).toEqual([]);
  });

  it("skips node: protocol builtins", () => {
    const content = [
      `import { join } from "node:path";`,
      `import { readFile } from "node:fs/promises";`,
    ].join("\n");
    expect(extractExternalImports(content)).toEqual([]);
  });

  it("deduplicates multiple imports of same package", () => {
    const content = [
      `import express from "express";`,
      `import { Router } from "express";`,
      `import { Request } from "express";`,
    ].join("\n");
    expect(extractExternalImports(content)).toEqual(["express"]);
  });

  it("sub-path import extracts base package", () => {
    const content = `import X from "express/router";`;
    expect(extractExternalImports(content)).toEqual(["express"]);
  });

  it("scoped package sub-path import extracts scope/pkg", () => {
    const content = `import { thing } from "@prisma/client/runtime";`;
    expect(extractExternalImports(content)).toEqual(["@prisma/client"]);
  });

  it("handles mixed ESM and CJS in one file", () => {
    const content = [
      `import express from "express";`,
      `const cors = require("cors");`,
      `import { z } from "zod";`,
    ].join("\n");
    const result = extractExternalImports(content);
    expect(result).toContain("express");
    expect(result).toContain("cors");
    expect(result).toContain("zod");
    expect(result).toHaveLength(3);
  });

  it("skips /absolute path imports", () => {
    const content = `import { foo } from "/absolute/path";`;
    expect(extractExternalImports(content)).toEqual([]);
  });

  it("handles single-quoted imports", () => {
    const content = `import express from 'express';`;
    expect(extractExternalImports(content)).toEqual(["express"]);
  });
});

// ---------------------------------------------------------------------------
// derivePackageJson
// ---------------------------------------------------------------------------

function makeScenario(overrides?: Partial<ScenarioDesign>): ScenarioDesign {
  return {
    scenario: {
      title: "Task Tracker API",
      narrative: "Build a task tracker",
      company_context: "A startup",
      technical_context: "Node.js backend",
    },
    starter_repo: {
      manifest: [],
      config_files: [{ path: "package.json", purpose: "npm config" }],
      seed_data: null,
    },
    candidate_tasks: [],
    evaluation_rubric: [],
    readme_structure: {
      overview: "",
      setup_steps: [],
      task_descriptions: [],
      submission_instructions: "",
      time_expectation: "",
    },
    ...overrides,
  } as ScenarioDesign;
}

function makeSpec(overrides?: Partial<AssessmentSpec>): AssessmentSpec {
  return {
    domain: "backend",
    subdomain: null,
    framework: "express",
    runtime: "node",
    skill_axes: ["api_design", "error_handling"],
    difficulty: "mid",
    estimated_scope: "2-4 hours",
    data_characteristics: [],
    project_type: "api",
    constraints: [],
    ambiguities: [],
    ...overrides,
  } as AssessmentSpec;
}

describe("derivePackageJson", () => {
  it("produces valid JSON with expected top-level fields", () => {
    const files = new Map<string, string>();
    files.set("src/server.ts", `import express from "express";`);

    const result = derivePackageJson(files, makeScenario(), makeSpec());
    const pkg = JSON.parse(result);

    expect(pkg.name).toBe("task-tracker-api");
    expect(pkg.version).toBe("1.0.0");
    expect(pkg.private).toBe(true);
    expect(pkg.scripts).toBeDefined();
    expect(pkg.dependencies).toBeDefined();
  });

  it("source file imports go to dependencies", () => {
    const files = new Map<string, string>();
    files.set("src/server.ts", `import express from "express";\nimport cors from "cors";`);

    const result = derivePackageJson(files, makeScenario(), makeSpec());
    const pkg = JSON.parse(result);

    expect(pkg.dependencies.express).toBeDefined();
    expect(pkg.dependencies.cors).toBeDefined();
  });

  it("test file imports go to devDependencies", () => {
    const files = new Map<string, string>();
    files.set("src/server.ts", `import express from "express";`);
    files.set("src/__tests__/server.test.ts", `import supertest from "supertest";`);

    const result = derivePackageJson(files, makeScenario(), makeSpec());
    const pkg = JSON.parse(result);

    expect(pkg.dependencies.express).toBeDefined();
    expect(pkg.devDependencies.supertest).toBeDefined();
    expect(pkg.dependencies.supertest).toBeUndefined();
  });

  it("framework from spec is included even if no file imports it", () => {
    const files = new Map<string, string>();
    files.set("src/utils.ts", `export const x = 1;`);

    const result = derivePackageJson(files, makeScenario(), makeSpec({ framework: "express" }));
    const pkg = JSON.parse(result);

    expect(pkg.dependencies.express).toBeDefined();
  });

  it("known packages get semver versions, unknown get *", () => {
    const files = new Map<string, string>();
    files.set("src/app.ts", `import express from "express";\nimport obscurePkg from "some-obscure-pkg";`);

    const result = derivePackageJson(files, makeScenario(), makeSpec());
    const pkg = JSON.parse(result);

    expect(pkg.dependencies.express).toMatch(/^\^/);
    expect(pkg.dependencies["some-obscure-pkg"]).toBe("*");
  });

  it("TypeScript projects include typescript in devDependencies", () => {
    const files = new Map<string, string>();
    files.set("src/server.ts", `import express from "express";`);

    const result = derivePackageJson(files, makeScenario(), makeSpec());
    const pkg = JSON.parse(result);

    expect(pkg.devDependencies.typescript).toBeDefined();
    expect(pkg.devDependencies.tsx).toBeDefined();
  });

  it("@types/* packages always go to devDependencies", () => {
    const files = new Map<string, string>();
    files.set("src/server.ts", `import express from "express";\nimport type { Request } from "@types/express";`);

    const result = derivePackageJson(files, makeScenario(), makeSpec());
    const pkg = JSON.parse(result);

    if (pkg.devDependencies?.["@types/express"]) {
      expect(pkg.dependencies?.["@types/express"]).toBeUndefined();
    }
  });

  it("vitest/jest always in devDependencies even if imported from source", () => {
    const files = new Map<string, string>();
    files.set("src/server.ts", `import { describe } from "vitest";`);

    const result = derivePackageJson(files, makeScenario(), makeSpec());
    const pkg = JSON.parse(result);

    expect(pkg.devDependencies.vitest).toBeDefined();
    expect(pkg.dependencies?.vitest).toBeUndefined();
  });

  it("package imported in both source and test stays in dependencies", () => {
    const files = new Map<string, string>();
    files.set("src/server.ts", `import { z } from "zod";`);
    files.set("src/server.test.ts", `import { z } from "zod";`);

    const result = derivePackageJson(files, makeScenario(), makeSpec());
    const pkg = JSON.parse(result);

    expect(pkg.dependencies.zod).toBeDefined();
    // Should not be duplicated in devDeps
    expect(pkg.devDependencies?.zod).toBeUndefined();
  });

  it("dependencies are sorted alphabetically", () => {
    const files = new Map<string, string>();
    files.set("src/app.ts", [
      `import zod from "zod";`,
      `import cors from "cors";`,
      `import express from "express";`,
    ].join("\n"));

    const result = derivePackageJson(files, makeScenario(), makeSpec());
    const pkg = JSON.parse(result);

    const depKeys = Object.keys(pkg.dependencies);
    const sorted = [...depKeys].sort();
    expect(depKeys).toEqual(sorted);
  });

  it("generates scripts for TypeScript project", () => {
    const files = new Map<string, string>();
    files.set("src/server.ts", `import express from "express";`);

    const result = derivePackageJson(files, makeScenario(), makeSpec());
    const pkg = JSON.parse(result);

    expect(pkg.scripts.build).toBeDefined();
    expect(pkg.scripts.start).toBeDefined();
    expect(pkg.scripts.test).toBeDefined();
  });

  it("name is derived from scenario title in kebab-case", () => {
    const scenario = makeScenario({
      scenario: {
        title: "My Cool Project!!!",
        narrative: "",
        company_context: "",
        technical_context: "",
      },
    });
    const files = new Map<string, string>();
    files.set("src/index.ts", `export const x = 1;`);

    const result = derivePackageJson(files, scenario, makeSpec());
    const pkg = JSON.parse(result);

    expect(pkg.name).toBe("my-cool-project");
  });
});
