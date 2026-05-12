import { describe, expect, it } from "vitest";
import { resolveAllAxes } from "../variation-planner.js";
import type { VariationAxis } from "../../skeletons/types.js";

const axes: VariationAxis[] = [
  {
    id: "filter_precedence",
    kind: "enum",
    values: ["clear", "preserve", "auto"],
    default: "preserve",
    description: "x",
  },
  {
    id: "edge_count_target",
    kind: "range",
    min: 3,
    max: 7,
    default: 5,
    description: "x",
  },
  {
    id: "loud_errors",
    kind: "bool",
    default: false,
    description: "x",
  },
];

describe("resolveAllAxes", () => {
  it("returns selected value when axis is in selections", () => {
    const resolved = resolveAllAxes(
      {
        selections: [
          {
            axisId: "filter_precedence",
            value: "auto",
            rationale: "",
            isDefault: false,
          },
        ],
        notApplicable: [],
        overallRationale: "",
      },
      axes,
    );
    expect(resolved.filter_precedence).toBe("auto");
  });

  it("falls back to default for unselected axes", () => {
    const resolved = resolveAllAxes(
      { selections: [], notApplicable: ["edge_count_target", "loud_errors"], overallRationale: "" },
      axes,
    );
    expect(resolved.filter_precedence).toBe("preserve");
    expect(resolved.edge_count_target).toBe(5);
    expect(resolved.loud_errors).toBe(false);
  });

  it("covers every axis in output", () => {
    const resolved = resolveAllAxes(
      { selections: [], notApplicable: [], overallRationale: "" },
      axes,
    );
    expect(Object.keys(resolved).sort()).toEqual([
      "edge_count_target",
      "filter_precedence",
      "loud_errors",
    ]);
  });
});
