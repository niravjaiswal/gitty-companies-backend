import { describe, expect, it } from "vitest";
import { buildDemoWorkspace, buildDemoAssessmentCopy } from "../../app/modules/assessments/demoWorkspace.js";

const EXPECTED_FILES = [
  "README.md",
  "package.json",
  "vite.config.ts",
  "tsconfig.json",
  "index.html",
  "src/main.tsx",
  "src/data.ts",
  "src/styles.css",
  "src/App.tsx",
  "src/App.test.tsx",
  "src/components/SidebarSummary.tsx",
  "src/components/MetricGrid.tsx",
  "src/components/LaunchComposer.tsx",
  "src/components/LaunchTaskList.tsx",
  "src/components/TimelineFeed.tsx",
];

describe("buildDemoWorkspace shim (pulseboard regression)", () => {
  it("returns all 15 expected files", async () => {
    const result = await buildDemoWorkspace({
      title: "Pulseboard Launch Sprint",
      instructionsMd: "",
    });

    const fileKeys = Object.keys(result.files).sort();
    expect(fileKeys).toEqual(EXPECTED_FILES.sort());
  });

  it("sets entryFilePath to README.md", async () => {
    const result = await buildDemoWorkspace({
      title: "Pulseboard Launch Sprint",
      instructionsMd: "",
    });

    expect(result.entryFilePath).toBe("README.md");
  });

  it("includes generatedAt timestamp", async () => {
    const result = await buildDemoWorkspace({
      title: "Pulseboard Launch Sprint",
      instructionsMd: "",
    });

    expect(result.generatedAt).toBeTruthy();
    expect(() => new Date(result.generatedAt)).not.toThrow();
  });

  it("interpolates custom title into README, index.html, and App.tsx", async () => {
    const result = await buildDemoWorkspace({
      title: "Custom Sprint Title",
      instructionsMd: "",
    });

    expect(result.files["README.md"]).toMatch(/^# Custom Sprint Title/);
    expect(result.files["index.html"]).toContain(
      "<title>Custom Sprint Title</title>",
    );
    expect(result.files["src/App.tsx"]).toContain(
      'title="Custom Sprint Title"',
    );
  });

  it("uses default title when empty string provided", async () => {
    const result = await buildDemoWorkspace({
      title: "",
      instructionsMd: "",
    });

    expect(result.files["README.md"]).toMatch(
      /^# Pulseboard Launch Sprint/,
    );
    expect(result.files["index.html"]).toContain(
      "<title>Pulseboard Launch Sprint</title>",
    );
  });

  it("interpolates custom instructions into README", async () => {
    const customInstructions = "# Custom Instructions\n\nDo something different.";
    const result = await buildDemoWorkspace({
      title: "",
      instructionsMd: customInstructions,
    });

    expect(result.files["README.md"]).toContain(customInstructions);
    expect(result.files["README.md"]).not.toContain(
      "You are stepping into Pulseboard",
    );
  });

  it("preserves key content in source files", async () => {
    const result = await buildDemoWorkspace({
      title: "Pulseboard Launch Sprint",
      instructionsMd: "",
    });

    expect(result.files["src/App.tsx"]).toContain("handleAddTask");
    expect(result.files["src/App.tsx"]).toContain("LaunchComposer");
    expect(result.files["src/App.test.tsx"]).toContain(
      "Pulseboard launch dashboard",
    );
    expect(result.files["src/data.ts"]).toContain("initialLaunchTasks");
    expect(result.files["src/styles.css"]).toContain(".shell");
    expect(result.files["package.json"]).toContain("vitest");
  });
});

describe("buildDemoAssessmentCopy", () => {
  it("returns defaults when called with no args", () => {
    const copy = buildDemoAssessmentCopy();

    expect(copy.title).toBe("Pulseboard Launch Sprint");
    expect(copy.summary).toContain("React + TypeScript assessment");
    expect(copy.instructionsMd).toContain("launch-readiness dashboard");
  });

  it("overrides with provided values", () => {
    const copy = buildDemoAssessmentCopy({
      title: "Custom",
      summary: "Custom summary",
      instructionsMd: "Custom instructions",
    });

    expect(copy.title).toBe("Custom");
    expect(copy.summary).toBe("Custom summary");
    expect(copy.instructionsMd).toBe("Custom instructions");
  });

  it("falls back to defaults for empty strings", () => {
    const copy = buildDemoAssessmentCopy({
      title: "  ",
      summary: "",
      instructionsMd: "  ",
    });

    expect(copy.title).toBe("Pulseboard Launch Sprint");
    expect(copy.summary).toContain("React + TypeScript assessment");
    expect(copy.instructionsMd).toContain("launch-readiness dashboard");
  });
});
