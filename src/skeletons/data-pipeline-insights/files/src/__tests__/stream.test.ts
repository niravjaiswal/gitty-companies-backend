import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { sampleEvents, defaultWindowMinutes } from "../data.js";
import { collectWindowInsights, createWindowInsightStream } from "../stream.js";

describe("stream insights", () => {
  it("emits sorted window summaries", async () => {
    const insights = await collectWindowInsights(sampleEvents, defaultWindowMinutes);

    expect(insights).toHaveLength(3);
    expect(insights[0].windowStart).toBe("2025-04-15T09:00:00.000Z");
    expect(insights[0].severity).toBe("red");
    expect(insights[0].lateEvents).toBe(2);
  });

  it("works as an object-mode transform", async () => {
    const stream = Readable.from(sampleEvents, { objectMode: true }).pipe(
      createWindowInsightStream(defaultWindowMinutes),
    );

    const outputs = [] as unknown[];
    for await (const entry of stream) {
      outputs.push(entry);
    }

    expect(outputs).toHaveLength(3);
    expect((outputs[2] as { severity: string }).severity).toBe("green");
  });
});
