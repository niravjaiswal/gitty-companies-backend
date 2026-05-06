import { describe, expect, it } from "vitest";
import {
  checkPathConsistency,
  extractFilePaths,
  extractScripts,
} from "../path-consistency.js";
import type { RemixedWorkspace } from "../types.js";

function makeWorkspace(files: Record<string, string>): RemixedWorkspace {
  return {
    files,
    scenario: { title: "T", company_name: "Acme", narrative: "N" },
    tasks: [],
    rubric: [],
  };
}

describe("extractFilePaths", () => {
  it("captures backticked path with extension", () => {
    const hits = extractFilePaths("Edit `src/data.ts` to fix it.");
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe("src/data.ts");
    expect(hits[0].inBacktick).toBe(true);
  });

  it("captures bare path with slash + extension", () => {
    const hits = extractFilePaths("Open src/index.ts and look around.");
    expect(hits.map((h) => h.path)).toContain("src/index.ts");
  });

  it("ignores URLs", () => {
    const hits = extractFilePaths("See https://example.com/foo.ts for details.");
    expect(hits).toHaveLength(0);
  });

  it("ignores scoped npm packages", () => {
    const hits = extractFilePaths("Install `@anthropic-ai/sdk` first.");
    expect(hits).toHaveLength(0);
  });

  it("ignores glob patterns", () => {
    const hits = extractFilePaths("Run on `**/*.test.ts` files.");
    expect(hits).toHaveLength(0);
  });

  it("flags shell-fenced paths with inFencedShell=true", () => {
    const text = "Try this:\n```bash\ncat src/missing.ts\n```";
    const hits = extractFilePaths(text);
    const missing = hits.find((h) => h.path === "src/missing.ts");
    expect(missing).toBeDefined();
    expect(missing!.inFencedShell).toBe(true);
  });

  it("captures top-level filenames without slashes", () => {
    const hits = extractFilePaths("Check `package.json` for the scripts.");
    expect(hits.map((h) => h.path)).toContain("package.json");
  });

  it("does not capture bare identifiers without paths", () => {
    const hits = extractFilePaths("Use `useEffect` and `useState`.");
    expect(hits).toHaveLength(0);
  });
});

describe("extractScripts", () => {
  it("captures `npm run X` scripts", () => {
    const hits = extractScripts("Then `npm run dev` to start.");
    expect(hits.map((h) => h.script)).toEqual(["dev"]);
  });

  it("captures `pnpm test` shorthand", () => {
    const hits = extractScripts("Verify with `pnpm test`.");
    expect(hits.map((h) => h.script)).toEqual(["test"]);
  });
});

describe("checkPathConsistency", () => {
  it("flags missing file referenced in instructionsMd with directive verb as error", () => {
    const workspace = makeWorkspace({ "src/data.ts": "// data" });
    const report = checkPathConsistency({
      instructionsMd: "Edit `src/sample-data.ts` to add new records.",
      workspace,
    });
    expect(report.pass).toBe(false);
    expect(report.pathIssues).toHaveLength(1);
    expect(report.pathIssues[0].severity).toBe("error");
    expect(report.pathIssues[0].path).toBe("src/sample-data.ts");
  });

  it("suggests a basename match when one unique workspace path shares the basename", () => {
    const workspace = makeWorkspace({ "src/data.ts": "// data" });
    const report = checkPathConsistency({
      instructionsMd: "Edit `lib/data.ts` to add new records.",
      workspace,
    });
    expect(report.pathIssues).toHaveLength(1);
    expect(report.pathIssues[0].suggestion).toBe("src/data.ts");
  });

  it("passes when all referenced files exist", () => {
    const workspace = makeWorkspace({
      "src/index.ts": "// entry",
      "package.json": '{"scripts":{"dev":"vite"}}',
    });
    const report = checkPathConsistency({
      instructionsMd: "Edit `src/index.ts` then run `npm run dev`.",
      workspace,
    });
    expect(report.pass).toBe(true);
    expect(report.pathIssues).toHaveLength(0);
    expect(report.scriptIssues).toHaveLength(0);
  });

  it("flags missing file inside a fenced shell command as error", () => {
    const workspace = makeWorkspace({
      "README.md": "Try this:\n```bash\ncat src/missing.ts\n```",
    });
    const report = checkPathConsistency({ instructionsMd: "", workspace });
    const error = report.pathIssues.find((i) => i.path === "src/missing.ts");
    expect(error).toBeDefined();
    expect(error!.severity).toBe("error");
    expect(error!.source).toBe("readme");
  });

  it("flags missing file in tasks as warning, not error", () => {
    const workspace: RemixedWorkspace = {
      files: { "src/keep.ts": "" },
      scenario: { title: "", company_name: "", narrative: "" },
      tasks: [{ title: "T", description: "Touch `src/old.ts` somehow." }],
      rubric: [],
    };
    const report = checkPathConsistency({ instructionsMd: "", workspace });
    expect(report.pathIssues).toHaveLength(1);
    expect(report.pathIssues[0].severity).toBe("warning");
    expect(report.pathIssues[0].source).toBe("tasks");
    expect(report.pass).toBe(true);
  });

  it("flags missing npm script in instructionsMd as error", () => {
    const workspace = makeWorkspace({
      "src/index.ts": "",
      "package.json": '{"scripts":{"start":"node ."}}',
    });
    const report = checkPathConsistency({
      instructionsMd: "Run `npm run dev` to start the server.",
      workspace,
    });
    expect(report.scriptIssues).toHaveLength(1);
    expect(report.scriptIssues[0].script).toBe("dev");
    expect(report.scriptIssues[0].severity).toBe("error");
    expect(report.pass).toBe(false);
  });

  it("flags `npm test` when package.json has no test script", () => {
    const workspace = makeWorkspace({
      "package.json": '{"scripts":{"start":"node ."}}',
    });
    const report = checkPathConsistency({
      instructionsMd: "Run `npm test` to verify.",
      workspace,
    });
    expect(report.scriptIssues).toHaveLength(1);
    expect(report.scriptIssues[0].script).toBe("test");
  });

  it("does not flag `npm install` or `npm ci` (built-in npm subcommands)", () => {
    const workspace = makeWorkspace({
      "package.json": '{"scripts":{}}',
    });
    const report = checkPathConsistency({
      instructionsMd: "First run `npm install` then `npm ci`.",
      workspace,
    });
    expect(report.scriptIssues).toHaveLength(0);
  });

  it("does not crash on malformed package.json", () => {
    const workspace = makeWorkspace({
      "package.json": "{not json",
    });
    const report = checkPathConsistency({
      instructionsMd: "Run `npm run dev`.",
      workspace,
    });
    // package.json scripts unparseable → skip script check
    expect(report.scriptIssues).toHaveLength(0);
  });

  it("flags prose mention of missing file as warning", () => {
    const workspace = makeWorkspace({ "src/data.ts": "" });
    const report = checkPathConsistency({
      instructionsMd: "The file `src/legacy.ts` was the original location.",
      workspace,
    });
    expect(report.pathIssues).toHaveLength(1);
    expect(report.pathIssues[0].severity).toBe("warning");
    expect(report.pass).toBe(true);
  });

  it("ignores URLs and scoped packages everywhere", () => {
    const workspace = makeWorkspace({ "src/index.ts": "" });
    const report = checkPathConsistency({
      instructionsMd:
        "See https://docs.example.com/api/v1.json. Install `@types/node` first. Edit `src/index.ts`.",
      workspace,
    });
    expect(report.pathIssues).toHaveLength(0);
  });

  it("rubric mention surfaces as warning not error", () => {
    const workspace: RemixedWorkspace = {
      files: { "src/index.ts": "" },
      scenario: { title: "", company_name: "", narrative: "" },
      tasks: [],
      rubric: [{ criterion: "Quality of `src/old.ts` refactor", weight: 1 }],
    };
    const report = checkPathConsistency({ instructionsMd: "", workspace });
    expect(report.pathIssues).toHaveLength(1);
    expect(report.pathIssues[0].severity).toBe("warning");
    expect(report.pathIssues[0].source).toBe("rubric");
  });
});
