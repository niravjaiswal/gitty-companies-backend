import { describe, it, expect } from "vitest";
import type { LoadedSkeleton } from "../../types.js";
import { scoreLoadedSkeleton } from "../scoreSkeleton.js";
import { d1ModuleSpan } from "../static/d1_moduleSpan.js";
import { d2ContractSurface } from "../static/d2_contractSurface.js";
import { d3DomainDepth } from "../static/d3_domainDepth.js";
import { d4TestCoverage } from "../static/d4_testCoverage.js";
import { d5CrossLayerWiring } from "../static/d5_crossLayerWiring.js";

const MIN: LoadedSkeleton = {
  skeleton: {
    name: "min",
    language: "typescript",
    pattern: "rest-api",
    difficulty_range: { min: "junior", max: "junior" },
    skill_axes: ["api_design"],
    estimated_scope: { min: "1-2 hours", max: "1-2 hours" },
    domain_tags: ["backend"],
    description: "min",
  },
  manifest: {
    files: [
      { path: "README.md", role: "provided", adapt: true, purpose: "x" },
      { path: "src/index.ts", role: "provided", adapt: false, purpose: "x" },
      { path: "src/main.ts", role: "candidate", adapt: true, purpose: "x" },
    ],
  },
  files: {
    "README.md": "# min\nDo a thing.",
    "src/index.ts": "import './main.js'",
    "src/main.ts": `export function add(a: number, b: number) { return a + b; }`,
  },
};

const RICH: LoadedSkeleton = {
  skeleton: {
    name: "rich",
    language: "typescript",
    pattern: "full-stack",
    difficulty_range: { min: "mid", max: "senior" },
    skill_axes: ["api_design", "state_management"],
    estimated_scope: { min: "2-4 hours", max: "4-6 hours" },
    domain_tags: ["fullstack"],
    description: "rich",
  },
  manifest: {
    files: [
      { path: "README.md", role: "provided", adapt: true, purpose: "x" },
      { path: "src/shared/types.ts", role: "provided", adapt: false, purpose: "x" },
      { path: "src/shared/util.ts", role: "provided", adapt: false, purpose: "x" },
      { path: "src/server/api.ts", role: "provided", adapt: true, purpose: "x" },
      { path: "src/server/store.ts", role: "provided", adapt: true, purpose: "x" },
      { path: "src/client/app.tsx", role: "candidate", adapt: true, purpose: "x" },
      { path: "src/client/hooks.ts", role: "partial", adapt: true, purpose: "x" },
      { path: "src/__tests__/app.test.ts", role: "provided", adapt: true, purpose: "x" },
      { path: "src/__tests__/hooks.test.ts", role: "provided", adapt: true, purpose: "x" },
    ],
  },
  files: {
    "README.md": "# rich\nMultiple tradeoffs.",
    "src/shared/types.ts": Array.from({ length: 8 }, (_, i) => `export type T${i} = { id: string };`).join(
      "\n",
    ),
    "src/shared/util.ts":
      Array.from({ length: 6 }, (_, i) => `export function fn${i}(x: number) { return x + ${i}; }`).join(
        "\n",
      ),
    "src/server/api.ts": `import { T0 } from '../shared/types.js';\nimport { fn0 } from '../shared/util.js';\n` +
      Array.from({ length: 60 }, (_, i) => `export const route${i} = (x: T0) => fn0(${i});`).join("\n"),
    "src/server/store.ts": Array.from({ length: 60 }, (_, i) => `const x${i} = ${i};`).join("\n"),
    "src/client/app.tsx":
      `import { route0 } from '../server/api.js';\nimport { useApp } from './hooks.js';\n` +
      `export function App() { return null; }\n`.repeat(40),
    "src/client/hooks.ts":
      `import { fn1 } from '../shared/util.js';\nexport function useApp() { return fn1(1); }`,
    "src/__tests__/app.test.ts":
      `import { App } from '../client/app.js';\n` +
      Array.from({ length: 12 }, (_, i) => `it('case ${i} empty boundary', () => { expect(App()).toBe(null); });`).join("\n"),
    "src/__tests__/hooks.test.ts":
      `import { useApp } from '../client/hooks.js';\n` +
      `it('handles concurrent malformed', () => { expect(useApp()).toBe(2); });\nit('handles invalid', () => { expect(useApp()).toBe(2); });\nit('handles edge', () => { expect(useApp()).toBe(2); });`,
  },
};

describe("static dimensions", () => {
  it("MIN scores low across the board", () => {
    expect(d1ModuleSpan(MIN).score).toBeLessThanOrEqual(2);
    expect(d2ContractSurface(MIN).score).toBeLessThanOrEqual(2);
    expect(d3DomainDepth(MIN).score).toBeLessThanOrEqual(2);
    expect(d4TestCoverage(MIN).score).toBe(1);
    expect(d5CrossLayerWiring(MIN).score).toBe(1);
  });

  it("RICH scores higher than MIN on every static dim", () => {
    expect(d1ModuleSpan(RICH).score).toBeGreaterThan(d1ModuleSpan(MIN).score);
    expect(d2ContractSurface(RICH).score).toBeGreaterThan(d2ContractSurface(MIN).score);
    expect(d3DomainDepth(RICH).score).toBeGreaterThan(d3DomainDepth(MIN).score);
    expect(d4TestCoverage(RICH).score).toBeGreaterThan(d4TestCoverage(MIN).score);
    expect(d5CrossLayerWiring(RICH).score).toBeGreaterThan(d5CrossLayerWiring(MIN).score);
  });

  it("RICH has cross-layer wiring with shared contract", () => {
    const r = d5CrossLayerWiring(RICH);
    expect(r.evidence.layers).toContain("shared");
    expect(r.evidence.layers).toContain("server");
    expect(r.evidence.layers).toContain("client");
    expect(r.score).toBe(5);
  });

  it("RICH module span finds shared+server reachable from candidate", () => {
    const r = d1ModuleSpan(RICH);
    expect(r.score).toBeGreaterThanOrEqual(3);
    expect(r.evidence.reachableCount).toBeGreaterThanOrEqual(3);
  });
});

describe("scoreLoadedSkeleton orchestrator", () => {
  it("MIN with skipLlm lands bottom verdict", async () => {
    const r = await scoreLoadedSkeleton(MIN, { skipLlm: true });
    expect(r.tier).toBe("bottom");
    expect(["drop", "strengthen"]).toContain(r.verdict);
    expect(r.weakest.length).toBeGreaterThan(0);
  });

  it("RICH with skipLlm lands middle or top", async () => {
    const r = await scoreLoadedSkeleton(RICH, { skipLlm: true });
    expect(["middle", "top"]).toContain(r.tier);
  });
});
