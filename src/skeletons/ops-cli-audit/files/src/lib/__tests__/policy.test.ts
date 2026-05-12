import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PolicyValidationError,
  loadPolicyFile,
  mergeSuppressions,
  parsePolicyFile,
} from "../policy.js";

describe("parsePolicyFile", () => {
  it("parses a minimal valid policy", () => {
    const policy = parsePolicyFile(
      JSON.stringify({ version: 1, suppressions: ["billing:latency-budget"] }),
    );
    expect(policy.version).toBe(1);
    expect(policy.suppressions).toEqual(["billing:latency-budget"]);
  });

  it("trims and drops empty entries from the suppressions array", () => {
    const policy = parsePolicyFile(
      JSON.stringify({ version: 1, suppressions: ["  billing:* ", "", "  "] }),
    );
    expect(policy.suppressions).toEqual(["billing:*"]);
  });

  it("rejects malformed JSON with a descriptive error", () => {
    expect(() => parsePolicyFile("{ not json")).toThrow(PolicyValidationError);
  });

  it("rejects a non-object payload", () => {
    expect(() => parsePolicyFile("[]")).toThrow(/must be a JSON object/i);
  });

  it("rejects an unsupported version", () => {
    expect(() =>
      parsePolicyFile(JSON.stringify({ version: 2, suppressions: [] })),
    ).toThrow(/unsupported version/i);
  });

  it("rejects when suppressions is missing or not an array of strings", () => {
    expect(() =>
      parsePolicyFile(JSON.stringify({ version: 1, suppressions: [1, 2] })),
    ).toThrow(/suppressions array of strings/i);

    expect(() =>
      parsePolicyFile(JSON.stringify({ version: 1 })),
    ).toThrow(/suppressions array of strings/i);
  });

  it("preserves optional metadata when present", () => {
    const policy = parsePolicyFile(
      JSON.stringify({
        version: 1,
        suppressions: [],
        metadata: { owner: "release-eng" },
      }),
    );
    expect(policy.metadata?.owner).toBe("release-eng");
  });
});

describe("loadPolicyFile", () => {
  it("reads and parses a valid policy from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "policy-"));
    const path = join(dir, "p.json");
    await writeFile(
      path,
      JSON.stringify({ version: 1, suppressions: ["billing:*"] }),
      "utf8",
    );
    const policy = await loadPolicyFile(path);
    expect(policy.suppressions).toEqual(["billing:*"]);
  });
});

describe("mergeSuppressions — strategy precedence", () => {
  const inCode = ["billing:latency-budget", "search:ownership"];
  const fromFile = ["billing:*", "deploy:rollback-drill"];

  it("union returns the deduplicated combination of both sources", () => {
    const merged = mergeSuppressions({ inCode, fromFile, strategy: "union" });
    expect(merged.sort()).toEqual(
      ["billing:*", "billing:latency-budget", "deploy:rollback-drill", "search:ownership"].sort(),
    );
  });

  it("config-wins discards in-code rules when the file has any entries", () => {
    const merged = mergeSuppressions({ inCode, fromFile, strategy: "config-wins" });
    expect(merged.sort()).toEqual(["billing:*", "deploy:rollback-drill"].sort());
  });

  it("config-wins falls back to in-code when the file is empty", () => {
    const merged = mergeSuppressions({ inCode, fromFile: [], strategy: "config-wins" });
    expect(merged.sort()).toEqual(inCode.slice().sort());
  });

  it("in-code-wins discards file rules when in-code list is non-empty", () => {
    const merged = mergeSuppressions({ inCode, fromFile, strategy: "in-code-wins" });
    expect(merged.sort()).toEqual(inCode.slice().sort());
  });

  it("in-code-wins falls back to file rules when in-code is empty", () => {
    const merged = mergeSuppressions({ inCode: [], fromFile, strategy: "in-code-wins" });
    expect(merged.sort()).toEqual(fromFile.slice().sort());
  });

  it("union deduplicates exact overlapping entries", () => {
    const merged = mergeSuppressions({
      inCode: ["billing:latency-budget"],
      fromFile: ["billing:latency-budget", "search:ownership"],
      strategy: "union",
    });
    expect(merged.sort()).toEqual(["billing:latency-budget", "search:ownership"].sort());
  });

  it("trims whitespace and drops empty strings before merging", () => {
    const merged = mergeSuppressions({
      inCode: ["  billing:* ", ""],
      fromFile: ["search:ownership", "  "],
      strategy: "union",
    });
    expect(merged.sort()).toEqual(["billing:*", "search:ownership"].sort());
  });
});
