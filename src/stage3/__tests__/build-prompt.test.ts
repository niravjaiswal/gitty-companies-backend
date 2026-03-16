import { describe, it, expect } from "vitest";
import type { ScenarioDesign } from "../../stage2/scenario-schema.js";
import type { CompressedContext } from "../build-context.js";
import {
  buildTypesFilePrompt,
  buildConfigFilePrompt,
  buildSourceFilePrompt,
  buildReadmePrompt,
  buildRepairPrompt,
} from "../build-prompt.js";

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

function makeScenario(
  overrides?: Partial<ScenarioDesign>,
): ScenarioDesign {
  return {
    scenario: {
      title: "Task Tracker API",
      narrative:
        "Build a REST API for managing tasks in a project management tool.",
      company_context: "Acme Corp internal tooling team",
      technical_context:
        "Node.js backend with Express and PostgreSQL using TypeORM.",
    },
    starter_repo: {
      manifest: [
        {
          path: "src/types.ts",
          purpose: "Shared type definitions for domain models",
          provided_or_candidate: "provided",
          dependencies: [],
          exports: ["Task", "Project", "User"],
        },
        {
          path: "src/db.ts",
          purpose: "Database connection and query helpers",
          provided_or_candidate: "provided",
          dependencies: ["src/types.ts", "pg"],
          exports: ["getDb", "query"],
        },
        {
          path: "src/routes.ts",
          purpose: "Express route handlers for tasks CRUD",
          provided_or_candidate: "candidate",
          dependencies: ["src/types.ts", "src/db.ts", "express"],
          exports: ["taskRouter"],
        },
        {
          path: "src/middleware.ts",
          purpose: "Auth and validation middleware",
          provided_or_candidate: "partial",
          dependencies: ["src/types.ts", "express"],
          exports: ["authMiddleware", "validateBody"],
        },
      ],
      config_files: [
        { path: "tsconfig.json", purpose: "TypeScript configuration" },
        { path: ".env.example", purpose: "Environment variable template" },
      ],
      seed_data: null,
    },
    candidate_tasks: [
      {
        id: "task-1",
        title: "Implement task CRUD routes",
        description:
          "Create Express route handlers for creating, reading, updating, and deleting tasks.",
        target_files: ["src/routes.ts"],
        tests_for: ["src/routes.ts"],
        acceptance_criteria: [
          "GET /tasks returns all tasks",
          "POST /tasks creates a new task",
          "PUT /tasks/:id updates a task",
          "DELETE /tasks/:id removes a task",
        ],
        hints: ["Use the query helper from db.ts"],
        estimated_minutes: 30,
        order: 1,
      },
      {
        id: "task-2",
        title: "Add request validation",
        description:
          "Implement the validateBody middleware to check incoming request payloads.",
        target_files: ["src/middleware.ts"],
        tests_for: ["src/middleware.ts"],
        acceptance_criteria: [
          "Rejects requests with missing required fields",
          "Returns 400 with descriptive error message",
        ],
        hints: [],
        estimated_minutes: 20,
        order: 2,
      },
    ],
    evaluation_rubric: [
      {
        criterion: "Correct CRUD implementation",
        skill_axis: "api_design",
        weight: 40,
        scoring: {
          excellent: "All endpoints work with proper status codes",
          acceptable: "Most endpoints work",
          poor: "Endpoints missing or non-functional",
        },
        automated_testable: true,
        test_description: "Integration tests against all CRUD endpoints",
      },
    ],
    readme_structure: {
      overview: "A REST API for managing tasks in a project management tool.",
      setup_steps: [
        "npm install",
        "cp .env.example .env",
        "npm run db:migrate",
        "npm run dev",
      ],
      task_descriptions: [
        "Implement the task CRUD endpoints in src/routes.ts",
        "Add request validation middleware in src/middleware.ts",
      ],
      submission_instructions:
        "Push your changes to a new branch and open a pull request.",
      time_expectation: "2-3 hours",
    },
    ...overrides,
  };
}

function makeCompressedContext(
  overrides?: Partial<CompressedContext>,
): CompressedContext {
  return {
    project_title: "Task Tracker API",
    runtime: "node",
    framework: "express",
    narrative_oneliner:
      "Build a REST API for managing tasks in a project management tool.",
    all_exports: {
      "src/types.ts": ["Task", "Project", "User"],
      "src/db.ts": ["getDb", "query"],
      "src/routes.ts": ["taskRouter"],
      "src/middleware.ts": ["authMiddleware", "validateBody"],
    },
    type_definitions:
      "export interface Task { id: string; title: string; status: string; }\nexport interface Project { id: string; name: string; }\nexport interface User { id: string; email: string; }",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildTypesFilePrompt
// ---------------------------------------------------------------------------

describe("buildTypesFilePrompt", () => {
  const typesList =
    "- Task\n- Project\n- User\n\nContext for type design: some context";

  it("includes project title, runtime, and framework in the output", () => {
    const ctx = makeCompressedContext();
    const result = buildTypesFilePrompt(ctx, typesList);

    expect(result).toContain("Task Tracker API");
    expect(result).toContain("node");
    expect(result).toContain("express");
  });

  it("includes the types list", () => {
    const ctx = makeCompressedContext();
    const result = buildTypesFilePrompt(ctx, typesList);

    expect(result).toContain("- Task");
    expect(result).toContain("- Project");
    expect(result).toContain("- User");
  });

  it("includes the narrative oneliner", () => {
    const ctx = makeCompressedContext();
    const result = buildTypesFilePrompt(ctx, typesList);

    expect(result).toContain(
      "Build a REST API for managing tasks in a project management tool.",
    );
  });

  it("includes exports from the types file entry in all_exports", () => {
    const ctx = makeCompressedContext();
    const result = buildTypesFilePrompt(ctx, typesList);

    expect(result).toContain("Task, Project, User");
  });

  it("handles null framework by substituting 'none'", () => {
    const ctx = makeCompressedContext({ framework: null });
    const result = buildTypesFilePrompt(ctx, typesList);

    expect(result).toContain("Framework: none");
    expect(result).not.toContain("Framework: null");
  });

  it("handles missing types file in all_exports gracefully", () => {
    const ctx = makeCompressedContext({
      all_exports: { "src/db.ts": ["getDb"] },
    });
    const result = buildTypesFilePrompt(ctx, typesList);

    // The exports placeholder should be replaced with an empty string
    expect(result).toContain("All exports from this file:");
  });
});

// ---------------------------------------------------------------------------
// buildConfigFilePrompt
// ---------------------------------------------------------------------------

describe("buildConfigFilePrompt", () => {
  it("includes config path and purpose", () => {
    const scenario = makeScenario();
    const spec = { runtime: "node", framework: "express" };

    const result = buildConfigFilePrompt(
      "tsconfig.json",
      "TypeScript configuration",
      scenario,
      spec,
    );

    expect(result).toContain("tsconfig.json");
    expect(result).toContain("TypeScript configuration");
  });

  it("includes project title from scenario", () => {
    const scenario = makeScenario();
    const spec = { runtime: "node", framework: "express" };

    const result = buildConfigFilePrompt(
      "tsconfig.json",
      "TypeScript configuration",
      scenario,
      spec,
    );

    expect(result).toContain("Task Tracker API");
  });

  it("includes runtime and framework from spec", () => {
    const scenario = makeScenario();
    const spec = { runtime: "node", framework: "express" };

    const result = buildConfigFilePrompt(
      "tsconfig.json",
      "TypeScript configuration",
      scenario,
      spec,
    );

    expect(result).toContain("Runtime: node");
    expect(result).toContain("Framework: express");
  });

  it("defaults runtime to 'node' when spec.runtime is null", () => {
    const scenario = makeScenario();
    const spec = { runtime: null, framework: "express" };

    const result = buildConfigFilePrompt(
      "tsconfig.json",
      "TypeScript configuration",
      scenario,
      spec,
    );

    expect(result).toContain("Runtime: node");
  });

  it("defaults framework to 'none' when spec.framework is null", () => {
    const scenario = makeScenario();
    const spec = { runtime: "node", framework: null };

    const result = buildConfigFilePrompt(
      "tsconfig.json",
      "TypeScript configuration",
      scenario,
      spec,
    );

    expect(result).toContain("Framework: none");
  });

  it("includes inferred packages from framework and non-local dependencies", () => {
    const scenario = makeScenario();
    const spec = { runtime: "node", framework: "express" };

    const result = buildConfigFilePrompt(
      "tsconfig.json",
      "TypeScript configuration",
      scenario,
      spec,
    );

    // express comes from framework, pg from src/db.ts deps
    expect(result).toContain("express");
    expect(result).toContain("pg");
  });
});

// ---------------------------------------------------------------------------
// buildSourceFilePrompt
// ---------------------------------------------------------------------------

describe("buildSourceFilePrompt", () => {
  const scenario = makeScenario();
  const context = makeCompressedContext();
  const candidateTasks = scenario.candidate_tasks;

  it("includes file path, purpose, and exports", () => {
    const manifest = scenario.starter_repo.manifest[2]; // src/routes.ts
    const result = buildSourceFilePrompt(
      manifest,
      context,
      candidateTasks,
      ["express", "pg"],
    );

    expect(result).toContain("src/routes.ts");
    expect(result).toContain("Express route handlers for tasks CRUD");
    expect(result).toContain("taskRouter");
  });

  it('for "provided" mode, includes PROVIDED instruction and no task details', () => {
    const manifest = scenario.starter_repo.manifest[1]; // src/db.ts - provided
    const result = buildSourceFilePrompt(
      manifest,
      context,
      candidateTasks,
      ["express", "pg"],
    );

    expect(result).toContain("Mode: provided");
    expect(result).toContain("This is a PROVIDED file");
    expect(result).toContain(
      "Write a complete, fully working implementation",
    );
    expect(result).not.toContain("Tasks the candidate will implement");
    expect(result).not.toContain("Tasks for the TODO sections");
  });

  it('for "candidate" mode, includes CANDIDATE instruction and matching tasks', () => {
    const manifest = scenario.starter_repo.manifest[2]; // src/routes.ts - candidate
    const result = buildSourceFilePrompt(
      manifest,
      context,
      candidateTasks,
      ["express", "pg"],
    );

    expect(result).toContain("Mode: candidate");
    expect(result).toContain("This is a CANDIDATE file");
    expect(result).toContain("ONLY the skeleton");
    expect(result).toContain("Tasks the candidate will implement");
    expect(result).toContain("Implement task CRUD routes");
    expect(result).toContain("GET /tasks returns all tasks");
  });

  it('for "partial" mode, includes PARTIAL instruction and matching tasks', () => {
    const manifest = scenario.starter_repo.manifest[3]; // src/middleware.ts - partial
    const result = buildSourceFilePrompt(
      manifest,
      context,
      candidateTasks,
      ["express", "pg"],
    );

    expect(result).toContain("Mode: partial");
    expect(result).toContain("This is a PARTIAL file");
    expect(result).toContain("TODO: BEGIN");
    expect(result).toContain("TODO: END");
    expect(result).toContain("Tasks for the TODO sections");
    expect(result).toContain("Add request validation");
    expect(result).toContain("Rejects requests with missing required fields");
  });

  it("includes dependency details with their exports for local deps", () => {
    const manifest = scenario.starter_repo.manifest[2]; // src/routes.ts
    const result = buildSourceFilePrompt(
      manifest,
      context,
      candidateTasks,
      ["express", "pg"],
    );

    // src/types.ts is a local dep with known exports
    expect(result).toContain("src/types.ts: exports [Task, Project, User]");
    // src/db.ts is a local dep with known exports
    expect(result).toContain("src/db.ts: exports [getDb, query]");
    // express is an external dep
    expect(result).toContain("express: (external)");
  });

  it("includes type definitions from context", () => {
    const manifest = scenario.starter_repo.manifest[2];
    const result = buildSourceFilePrompt(
      manifest,
      context,
      candidateTasks,
      ["express", "pg"],
    );

    expect(result).toContain("export interface Task");
    expect(result).toContain("export interface Project");
  });

  it("handles files with no dependencies", () => {
    const manifest = scenario.starter_repo.manifest[0]; // src/types.ts - no deps
    const result = buildSourceFilePrompt(
      manifest,
      context,
      candidateTasks,
      ["express"],
    );

    expect(result).toContain("(none)");
  });

  it("includes project context fields", () => {
    const manifest = scenario.starter_repo.manifest[0];
    const result = buildSourceFilePrompt(
      manifest,
      context,
      candidateTasks,
      ["express"],
    );

    expect(result).toContain("Title: Task Tracker API");
    expect(result).toContain("Runtime: node");
    expect(result).toContain("Framework: express");
  });

  it("handles null framework as 'none' in project context", () => {
    const manifest = scenario.starter_repo.manifest[0];
    const ctxNoFramework = makeCompressedContext({ framework: null });
    const result = buildSourceFilePrompt(
      manifest,
      ctxNoFramework,
      candidateTasks,
      ["express"],
    );

    expect(result).toContain("Framework: none");
  });

  it("includes available packages", () => {
    const manifest = scenario.starter_repo.manifest[2];
    const result = buildSourceFilePrompt(
      manifest,
      context,
      candidateTasks,
      ["express", "pg", "dotenv"],
    );

    expect(result).toContain("express, pg, dotenv");
  });

  it("shows '(none)' when packages list is empty", () => {
    const manifest = scenario.starter_repo.manifest[0];
    const result = buildSourceFilePrompt(
      manifest,
      context,
      candidateTasks,
      [],
    );

    expect(result).toContain("(none)");
  });

  it("candidate mode with no matching tasks produces no task details block", () => {
    const manifest = scenario.starter_repo.manifest[2]; // src/routes.ts - candidate
    // Pass empty tasks array so nothing matches
    const result = buildSourceFilePrompt(manifest, context, [], ["express"]);

    expect(result).toContain("This is a CANDIDATE file");
    expect(result).not.toContain("Tasks the candidate will implement");
  });
});

// ---------------------------------------------------------------------------
// buildReadmePrompt
// ---------------------------------------------------------------------------

describe("buildReadmePrompt", () => {
  const scenario = makeScenario();
  const allFilePaths = [
    "src/types.ts",
    "src/db.ts",
    "src/routes.ts",
    "src/middleware.ts",
    "tsconfig.json",
    ".env.example",
  ];

  it("includes the project title", () => {
    const result = buildReadmePrompt(scenario, allFilePaths);

    expect(result).toContain("Task Tracker API");
  });

  it("includes all file paths in the file list", () => {
    const result = buildReadmePrompt(scenario, allFilePaths);

    for (const fp of allFilePaths) {
      expect(result).toContain(`- ${fp}`);
    }
  });

  it("includes setup steps", () => {
    const result = buildReadmePrompt(scenario, allFilePaths);

    expect(result).toContain("- npm install");
    expect(result).toContain("- cp .env.example .env");
    expect(result).toContain("- npm run db:migrate");
    expect(result).toContain("- npm run dev");
  });

  it("includes numbered task descriptions", () => {
    const result = buildReadmePrompt(scenario, allFilePaths);

    expect(result).toContain(
      "1. Implement the task CRUD endpoints in src/routes.ts",
    );
    expect(result).toContain(
      "2. Add request validation middleware in src/middleware.ts",
    );
  });

  it("includes overview text", () => {
    const result = buildReadmePrompt(scenario, allFilePaths);

    expect(result).toContain(
      "A REST API for managing tasks in a project management tool.",
    );
  });

  it("includes submission instructions and time expectation", () => {
    const result = buildReadmePrompt(scenario, allFilePaths);

    expect(result).toContain(
      "Push your changes to a new branch and open a pull request.",
    );
    expect(result).toContain("2-3 hours");
  });
});

// ---------------------------------------------------------------------------
// buildRepairPrompt
// ---------------------------------------------------------------------------

describe("buildRepairPrompt", () => {
  it("includes the file path", () => {
    const result = buildRepairPrompt(
      "src/routes.ts",
      ["Type 'string' is not assignable to type 'number'"],
      "const x: number = 'hello';",
    );

    expect(result).toContain('"src/routes.ts"');
  });

  it("includes all errors as a bulleted list", () => {
    const errors = [
      "TS2322: Type 'string' is not assignable to type 'number'",
      "TS2304: Cannot find name 'foo'",
      "TS7006: Parameter 'x' implicitly has an 'any' type",
    ];

    const result = buildRepairPrompt("src/routes.ts", errors, "const x = 1;");

    for (const err of errors) {
      expect(result).toContain(`- ${err}`);
    }
  });

  it("includes the file content", () => {
    const content = `import express from "express";\n\nconst router = express.Router();\n\nexport default router;`;

    const result = buildRepairPrompt(
      "src/routes.ts",
      ["Missing return type"],
      content,
    );

    expect(result).toContain(content);
  });

  it("wraps content in a code fence", () => {
    const result = buildRepairPrompt(
      "src/index.ts",
      ["Error"],
      "console.log('hi');",
    );

    expect(result).toContain("```\nconsole.log('hi');\n```");
  });
});
