import { describe, expect, it } from "vitest";
import { main } from "../cli.js";

describe("CLI", () => {
  it("returns the rendered report text", async () => {
    const output = await main();

    expect(output).toContain("Pipeline Insights Console");
    expect(output).toContain("late events");
  });
});
