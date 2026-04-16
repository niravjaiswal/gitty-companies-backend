import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../cli.js";
import { sampleSnapshot } from "../data.js";

function createCapture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (chunk: string) => (stdout.push(chunk), true) },
      stderr: { write: (chunk: string) => (stderr.push(chunk), true) },
    },
    stdout,
    stderr,
  };
}

describe("runCli", () => {
  it("prints a text report for the bundled snapshot", async () => {
    const capture = createCapture();
    const exitCode = await runCli([], capture.io);

    expect(exitCode).toBe(0);
    const output = capture.stdout.join("");
    expect(output).toContain("Ops CLI Audit");
    expect(output).toContain("billing:latency-budget");
    expect(output).toContain("search:ownership");
  });

  it("supports json output", async () => {
    const capture = createCapture();
    const exitCode = await runCli(["--format", "json"], capture.io);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(capture.stdout.join(""));
    expect(parsed.environment).toBe(sampleSnapshot.environment);
    expect(parsed.findings).toHaveLength(4);
  });

  it("applies exact ignore rules", async () => {
    const capture = createCapture();
    const exitCode = await runCli(
      ["--ignore", "search:ownership"],
      capture.io,
    );

    expect(exitCode).toBe(0);
    const output = capture.stdout.join("");
    expect(output).not.toContain("search:ownership");
  });

  it("can read a snapshot from disk", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ops-cli-audit-"));
    const snapshotPath = join(tempDir, "snapshot.json");
    await writeFile(snapshotPath, JSON.stringify(sampleSnapshot), "utf8");

    const capture = createCapture();
    const exitCode = await runCli(["--input", snapshotPath], capture.io);

    expect(exitCode).toBe(0);
    expect(capture.stdout.join("")).toContain("notifications");
  });
});
