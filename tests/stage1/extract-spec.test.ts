import { describe, it, expect } from "vitest";
import { extractSpec } from "../../src/pipeline/stage1/extract-spec.js";
import { AssessmentSpecSchema } from "../../src/pipeline/stage1/spec-schema.js";
import { fixtures } from "./fixtures.js";

describe("extractSpec", () => {
  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      let result: Awaited<ReturnType<typeof extractSpec>>;

      it("should return a valid AssessmentSpec", async () => {
        result = await extractSpec(fixture.input);

        const parsed = AssessmentSpecSchema.safeParse(result);
        expect(parsed.success).toBe(true);
        expect(result.skill_axes.length).toBeGreaterThanOrEqual(2);
        expect(result.skill_axes.length).toBeLessThanOrEqual(5);
        expect(result.data_characteristics.length).toBeGreaterThanOrEqual(0);
        expect(result.data_characteristics.length).toBeLessThanOrEqual(4);
      });

      it("should match expected fields", () => {
        for (const [key, expected] of Object.entries(fixture.expectedFields)) {
          const actual = (result as Record<string, unknown>)[key];

          if (Array.isArray(expected)) {
            for (const item of expected) {
              expect(actual).toContain(item);
            }
          } else {
            expect(actual).toBe(expected);
          }
        }
      });
    });
  }
});
