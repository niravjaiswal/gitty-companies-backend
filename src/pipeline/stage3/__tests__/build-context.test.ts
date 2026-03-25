import { describe, it, expect } from "vitest";
import { buildCompressedContext, deriveTypesList } from "../build-context.js";
import type { ScenarioDesign } from "../../stage2/scenario-schema.js";
import type { AssessmentSpec } from "../../stage1/spec-schema.js";

function makeScenario(overrides?: {
  title?: string;
  narrative?: string;
  technical_context?: string;
  manifest?: ScenarioDesign["starter_repo"]["manifest"];
}): ScenarioDesign {
  return {
    scenario: {
      title: overrides?.title ?? "Inventory Tracker",
      narrative:
        overrides?.narrative ??
        "Build a warehouse inventory system. It should handle concurrent updates.",
      company_context: "A mid-size logistics company",
      technical_context:
        overrides?.technical_context ?? "Uses PostgreSQL and Redis for caching",
    },
    starter_repo: {
      manifest: overrides?.manifest ?? [
        {
          path: "src/models/product.ts",
          purpose: "Product model",
          provided_or_candidate: "provided",
          dependencies: [],
          exports: ["Product", "ProductVariant", "createProduct()"],
        },
        {
          path: "src/services/inventory.ts",
          purpose: "Inventory service",
          provided_or_candidate: "candidate",
          dependencies: ["src/models/product.ts"],
          exports: ["InventoryService", "updateStock", "StockLevel"],
        },
      ],
      config_files: [{ path: "tsconfig.json", purpose: "TypeScript config" }],
      seed_data: null,
    },
    candidate_tasks: [
      {
        id: "task-1",
        title: "Implement stock updates",
        description: "Handle concurrent stock updates",
        target_files: ["src/services/inventory.ts"],
        tests_for: ["updateStock"],
        acceptance_criteria: ["Stock levels are accurate"],
        hints: ["Use optimistic locking"],
        estimated_minutes: 30,
        order: 1,
      },
    ],
    evaluation_rubric: [
      {
        criterion: "Concurrency handling",
        skill_axis: "concurrency",
        weight: 1,
        scoring: {
          excellent: "Handles all race conditions",
          acceptable: "Handles basic concurrency",
          poor: "No concurrency handling",
        },
        automated_testable: true,
        test_description: "Test concurrent updates",
      },
    ],
    readme_structure: {
      overview: "Inventory management system",
      setup_steps: ["npm install"],
      task_descriptions: ["Implement stock updates"],
      submission_instructions: "Submit via PR",
      time_expectation: "2 hours",
    },
  };
}

function makeSpec(overrides?: {
  runtime?: string | null;
  framework?: string | null;
}): AssessmentSpec {
  return {
    domain: "backend",
    subdomain: "api",
    framework: overrides?.framework !== undefined ? overrides.framework : "fastify",
    runtime: overrides?.runtime !== undefined ? overrides.runtime : "node",
    skill_axes: ["api_design", "error_handling"],
    difficulty: "mid",
    estimated_scope: "2-4 hours",
    data_characteristics: ["relational"],
    project_type: "REST API",
    constraints: ["Must use TypeScript"],
    ambiguities: ["Error response format is unspecified"],
  };
}

// ---------------------------------------------------------------------------
// buildCompressedContext
// ---------------------------------------------------------------------------
describe("buildCompressedContext", () => {
  it("returns project_title from scenario", () => {
    const scenario = makeScenario({ title: "Order Pipeline" });
    const spec = makeSpec();

    const result = buildCompressedContext(scenario, spec);

    expect(result.project_title).toBe("Order Pipeline");
  });

  it("returns runtime from spec", () => {
    const scenario = makeScenario();
    const spec = makeSpec({ runtime: "deno" });

    const result = buildCompressedContext(scenario, spec);

    expect(result.runtime).toBe("deno");
  });

  it("falls back to 'node' when spec.runtime is null", () => {
    const scenario = makeScenario();
    const spec = makeSpec({ runtime: null });

    const result = buildCompressedContext(scenario, spec);

    expect(result.runtime).toBe("node");
  });

  it("returns framework from spec", () => {
    const scenario = makeScenario();
    const spec = makeSpec({ framework: "express" });

    const result = buildCompressedContext(scenario, spec);

    expect(result.framework).toBe("express");
  });

  it("returns null framework when spec.framework is null", () => {
    const scenario = makeScenario();
    const spec = makeSpec({ framework: null });

    const result = buildCompressedContext(scenario, spec);

    expect(result.framework).toBeNull();
  });

  it("truncates narrative to first sentence", () => {
    const scenario = makeScenario({
      narrative:
        "Build a warehouse inventory system. It should handle concurrent updates. Third sentence here.",
    });
    const spec = makeSpec();

    const result = buildCompressedContext(scenario, spec);

    expect(result.narrative_oneliner).toBe(
      "Build a warehouse inventory system.",
    );
  });

  it("appends period when first sentence does not end with one", () => {
    const scenario = makeScenario({
      narrative: "Build a warehouse inventory system. More details follow.",
    });
    const spec = makeSpec();

    const result = buildCompressedContext(scenario, spec);

    expect(result.narrative_oneliner).toBe(
      "Build a warehouse inventory system.",
    );
  });

  it("does not double-period when narrative is a single sentence ending with period", () => {
    const scenario = makeScenario({
      narrative: "Build a warehouse inventory system.",
    });
    const spec = makeSpec();

    const result = buildCompressedContext(scenario, spec);

    expect(result.narrative_oneliner).toBe(
      "Build a warehouse inventory system.",
    );
  });

  it("builds all_exports map from manifest entries", () => {
    const scenario = makeScenario({
      manifest: [
        {
          path: "src/a.ts",
          purpose: "Module A",
          provided_or_candidate: "provided",
          dependencies: [],
          exports: ["Foo", "bar"],
        },
        {
          path: "src/b.ts",
          purpose: "Module B",
          provided_or_candidate: "candidate",
          dependencies: [],
          exports: ["Baz"],
        },
      ],
    });
    const spec = makeSpec();

    const result = buildCompressedContext(scenario, spec);

    expect(result.all_exports).toEqual({
      "src/a.ts": ["Foo", "bar"],
      "src/b.ts": ["Baz"],
    });
  });

  it("returns an empty all_exports map when manifest is empty", () => {
    const scenario = makeScenario({ manifest: [] });
    const spec = makeSpec();

    const result = buildCompressedContext(scenario, spec);

    expect(result.all_exports).toEqual({});
  });

  it("does NOT include type_definitions in the return value", () => {
    const scenario = makeScenario();
    const spec = makeSpec();

    const result = buildCompressedContext(scenario, spec);

    expect(result).not.toHaveProperty("type_definitions");
  });
});

// ---------------------------------------------------------------------------
// deriveTypesList
// ---------------------------------------------------------------------------
describe("deriveTypesList", () => {
  it("collects PascalCase exports (starting with uppercase, no parentheses)", () => {
    const scenario = makeScenario({
      manifest: [
        {
          path: "src/types.ts",
          purpose: "Domain types",
          provided_or_candidate: "provided",
          dependencies: [],
          exports: ["UserProfile", "OrderStatus", "createUser()"],
        },
      ],
    });

    const result = deriveTypesList(scenario);

    expect(result).toContain("- UserProfile");
    expect(result).toContain("- OrderStatus");
  });

  it("ignores camelCase exports", () => {
    const scenario = makeScenario({
      manifest: [
        {
          path: "src/utils.ts",
          purpose: "Utility functions",
          provided_or_candidate: "provided",
          dependencies: [],
          exports: ["formatDate", "parseInput", "validateEmail"],
        },
      ],
    });

    const result = deriveTypesList(scenario);

    expect(result).not.toContain("- formatDate");
    expect(result).not.toContain("- parseInput");
    expect(result).not.toContain("- validateEmail");
  });

  it("ignores exports with parentheses (function calls)", () => {
    const scenario = makeScenario({
      manifest: [
        {
          path: "src/factories.ts",
          purpose: "Factory functions",
          provided_or_candidate: "provided",
          dependencies: [],
          exports: ["CreateUser()", "BuildOrder()", "Config"],
        },
      ],
    });

    const result = deriveTypesList(scenario);

    expect(result).not.toContain("- CreateUser()");
    expect(result).not.toContain("- BuildOrder()");
    expect(result).toContain("- Config");
  });

  it("returns fallback message if no types found", () => {
    const scenario = makeScenario({
      manifest: [
        {
          path: "src/helpers.ts",
          purpose: "Helper functions",
          provided_or_candidate: "provided",
          dependencies: [],
          exports: ["helperOne", "helperTwo", "init()"],
        },
      ],
    });

    const result = deriveTypesList(scenario);

    expect(result).toContain(
      "- Define appropriate domain types based on the project context",
    );
  });

  it("deduplicates type names across multiple manifest entries", () => {
    const scenario = makeScenario({
      manifest: [
        {
          path: "src/a.ts",
          purpose: "Module A",
          provided_or_candidate: "provided",
          dependencies: [],
          exports: ["SharedType", "alpha"],
        },
        {
          path: "src/b.ts",
          purpose: "Module B",
          provided_or_candidate: "provided",
          dependencies: [],
          exports: ["SharedType", "beta"],
        },
      ],
    });

    const result = deriveTypesList(scenario);
    const occurrences = result.split("- SharedType").length - 1;

    expect(occurrences).toBe(1);
  });

  it("includes context from narrative and technical_context", () => {
    const scenario = makeScenario({
      narrative: "A real-time chat application.",
      technical_context: "Uses WebSockets and Redis pub/sub",
    });

    const result = deriveTypesList(scenario);

    expect(result).toContain("Context for type design:");
    expect(result).toContain("A real-time chat application.");
    expect(result).toContain("Uses WebSockets and Redis pub/sub");
  });
});
