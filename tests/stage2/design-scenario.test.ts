import { describe, it, expect } from "vitest";
import { designScenario } from "../../src/stage2/design-scenario.js";
import { ScenarioDesignSchema } from "../../src/stage2/scenario-schema.js";
import { validateCoherence } from "../../src/stage2/validate-coherence.js";
import { fixtures } from "./fixtures.js";

describe("designScenario", () => {
  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      let result: Awaited<ReturnType<typeof designScenario>>;

      it(
        "should return a valid ScenarioDesign",
        async () => {
          result = await designScenario(fixture.input);

          const parsed = ScenarioDesignSchema.safeParse(result);
          expect(parsed.success).toBe(true);

          expect(result.candidate_tasks.length).toBeGreaterThanOrEqual(1);
          expect(result.evaluation_rubric.length).toBeGreaterThanOrEqual(1);
          expect(result.starter_repo.manifest.length).toBeGreaterThanOrEqual(1);

          console.log(
            `\n--- ${fixture.name} ---\n`,
            JSON.stringify(result, null, 2),
          );
        },
        120_000,
      );

      it("should pass all coherence checks", () => {
        const coherence = validateCoherence(result, fixture.input);
        expect(coherence.errors).toEqual([]);
        expect(coherence.valid).toBe(true);
      });
    });
  }
});
