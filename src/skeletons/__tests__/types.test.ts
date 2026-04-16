import { describe, it, expect } from "vitest";
import {
  SkeletonSchema,
  ManifestSchema,
  ManifestFileEntrySchema,
} from "../types.js";

// ── Helpers ─────────────────────────────────────────────────────

function validSkeleton(overrides: Record<string, unknown> = {}) {
  return {
    name: "pulseboard-launch-sprint",
    language: "typescript",
    pattern: "react-spa",
    difficulty_range: { min: "mid", max: "senior" },
    skill_axes: ["state_management", "ui_component_design", "testing_strategy"],
    estimated_scope: { min: "2-4 hours", max: "4-6 hours" },
    domain_tags: ["frontend"],
    description: "A React dashboard for coordinating product launches",
    ...overrides,
  };
}

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    files: [
      {
        path: "src/App.tsx",
        role: "provided",
        adapt: true,
        purpose: "Main application component",
      },
      {
        path: "tsconfig.json",
        role: "provided",
        adapt: false,
        purpose: "TypeScript compiler config",
      },
    ],
    ...overrides,
  };
}

// ── SkeletonSchema ──────────────────────────────────────────────

describe("SkeletonSchema", () => {
  it("validates a well-formed skeleton", () => {
    const result = SkeletonSchema.safeParse(validSkeleton());
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const result = SkeletonSchema.safeParse(validSkeleton({ name: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects unknown language", () => {
    const result = SkeletonSchema.safeParse(validSkeleton({ language: "rust" }));
    expect(result.success).toBe(false);
  });

  it("rejects unknown pattern", () => {
    const result = SkeletonSchema.safeParse(validSkeleton({ pattern: "monolith" }));
    expect(result.success).toBe(false);
  });

  it("rejects empty skill_axes", () => {
    const result = SkeletonSchema.safeParse(validSkeleton({ skill_axes: [] }));
    expect(result.success).toBe(false);
  });

  it("rejects more than 8 skill_axes", () => {
    const axes = [
      "state_management", "ui_component_design", "testing_strategy",
      "api_design", "architecture", "error_handling", "debugging",
      "code_organization", "performance_optimization",
    ];
    const result = SkeletonSchema.safeParse(validSkeleton({ skill_axes: axes }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid difficulty enum values", () => {
    const result = SkeletonSchema.safeParse(
      validSkeleton({ difficulty_range: { min: "intern", max: "senior" } }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts all valid language values", () => {
    for (const lang of ["typescript", "python"]) {
      const result = SkeletonSchema.safeParse(validSkeleton({ language: lang }));
      expect(result.success).toBe(true);
    }
  });

  it("accepts all valid pattern values", () => {
    for (const pattern of [
      "react-spa", "rest-api", "cli-tool",
      "data-processing", "full-stack", "real-time",
    ]) {
      const result = SkeletonSchema.safeParse(validSkeleton({ pattern }));
      expect(result.success).toBe(true);
    }
  });

  it("rejects empty domain_tags", () => {
    const result = SkeletonSchema.safeParse(validSkeleton({ domain_tags: [] }));
    expect(result.success).toBe(false);
  });

  it("rejects missing description", () => {
    const result = SkeletonSchema.safeParse(validSkeleton({ description: "" }));
    expect(result.success).toBe(false);
  });
});

// ── ManifestSchema ──────────────────────────────────────────────

describe("ManifestSchema", () => {
  it("validates a well-formed manifest", () => {
    const result = ManifestSchema.safeParse(validManifest());
    expect(result.success).toBe(true);
  });

  it("rejects empty files array", () => {
    const result = ManifestSchema.safeParse(validManifest({ files: [] }));
    expect(result.success).toBe(false);
  });

  it("accepts all valid file roles", () => {
    for (const role of ["provided", "candidate", "partial"]) {
      const result = ManifestFileEntrySchema.safeParse({
        path: "src/index.ts",
        role,
        adapt: true,
        purpose: "Test file",
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects unknown file role", () => {
    const result = ManifestFileEntrySchema.safeParse({
      path: "src/index.ts",
      role: "hidden",
      adapt: true,
      purpose: "Test file",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty path", () => {
    const result = ManifestFileEntrySchema.safeParse({
      path: "",
      role: "provided",
      adapt: false,
      purpose: "Config",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing adapt flag", () => {
    const result = ManifestFileEntrySchema.safeParse({
      path: "src/index.ts",
      role: "provided",
      purpose: "Entry point",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty purpose", () => {
    const result = ManifestFileEntrySchema.safeParse({
      path: "src/index.ts",
      role: "provided",
      adapt: true,
      purpose: "",
    });
    expect(result.success).toBe(false);
  });

  it("validates a manifest with mixed adapt flags", () => {
    const result = ManifestSchema.safeParse({
      files: [
        { path: "src/App.tsx", role: "provided", adapt: true, purpose: "App component" },
        { path: "src/data.ts", role: "partial", adapt: true, purpose: "Data layer" },
        { path: "tsconfig.json", role: "provided", adapt: false, purpose: "TS config" },
        { path: "package.json", role: "provided", adapt: false, purpose: "Dependencies" },
        { path: "src/task.ts", role: "candidate", adapt: true, purpose: "Candidate implements" },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const adaptFiles = result.data.files.filter((f) => f.adapt);
      const staticFiles = result.data.files.filter((f) => !f.adapt);
      expect(adaptFiles).toHaveLength(3);
      expect(staticFiles).toHaveLength(2);
    }
  });
});

