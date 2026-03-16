import type { AssessmentSpec } from "../stage1/spec-schema.js";
import type { ScenarioDesign } from "./scenario-schema.js";

export interface CoherenceResult {
  valid: boolean;
  errors: string[];
}

export function parseScopeToMinutes(scope: string): number {
  const match = scope.match(/(\d+)-(\d+)\s*hours?/i);
  if (!match) return 480;
  return parseInt(match[2], 10) * 60;
}

export function buildDepGraph(
  manifest: Array<{ path: string; dependencies: string[] }>,
): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const file of manifest) {
    graph.set(file.path, file.dependencies);
  }
  return graph;
}

export function hasCycle(graph: Map<string, string[]>): boolean {
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string): boolean {
    if (inStack.has(node)) return true;
    if (visited.has(node)) return false;

    visited.add(node);
    inStack.add(node);

    const neighbors = graph.get(node) ?? [];
    for (const neighbor of neighbors) {
      if (dfs(neighbor)) return true;
    }

    inStack.delete(node);
    return false;
  }

  for (const node of graph.keys()) {
    if (dfs(node)) return true;
  }

  return false;
}

export function validateCoherence(
  design: ScenarioDesign,
  spec: AssessmentSpec,
): CoherenceResult {
  const errors: string[] = [];

  // 1. Every skill_axis from spec appears in at least one rubric criterion
  const rubricAxes = new Set(design.evaluation_rubric.map((r) => r.skill_axis));
  for (const axis of spec.skill_axes) {
    if (!rubricAxes.has(axis)) {
      errors.push(
        `Skill axis "${axis}" is not covered by any rubric criterion`,
      );
    }
  }

  // 2. Every skill_axis from spec appears in at least one task's tests_for
  const taskAxes = new Set(
    design.candidate_tasks.flatMap((t) => t.tests_for),
  );
  for (const axis of spec.skill_axes) {
    if (!taskAxes.has(axis)) {
      errors.push(`Skill axis "${axis}" is not tested by any task`);
    }
  }

  // 3. Rubric weights sum to exactly 100
  const totalWeight = design.evaluation_rubric.reduce(
    (sum, r) => sum + r.weight,
    0,
  );
  if (totalWeight !== 100) {
    errors.push(`Rubric weights sum to ${totalWeight}, expected 100`);
  }

  // 4. At least 40% of total rubric weight is automated_testable
  const automatedWeight = design.evaluation_rubric
    .filter((r) => r.automated_testable)
    .reduce((sum, r) => sum + r.weight, 0);
  if (automatedWeight < 40) {
    errors.push(
      `Only ${automatedWeight}% of rubric weight is automated_testable, minimum is 40%`,
    );
  }

  // 5. Total task estimated_minutes fits within spec.estimated_scope
  const totalMinutes = design.candidate_tasks.reduce(
    (sum, t) => sum + t.estimated_minutes,
    0,
  );
  const maxMinutes = parseScopeToMinutes(spec.estimated_scope);
  if (totalMinutes > maxMinutes) {
    errors.push(
      `Total estimated time ${totalMinutes} minutes exceeds scope limit of ${maxMinutes} minutes`,
    );
  }

  // 6. No circular dependencies in file manifest
  const depGraph = buildDepGraph(design.starter_repo.manifest);
  if (hasCycle(depGraph)) {
    errors.push("File manifest contains circular dependencies");
  }

  // 7. Every task's target_files exist in the manifest
  const manifestPaths = new Set(
    design.starter_repo.manifest.map((f) => f.path),
  );
  for (const task of design.candidate_tasks) {
    for (const file of task.target_files) {
      if (!manifestPaths.has(file)) {
        errors.push(
          `Task "${task.id}" references file "${file}" which is not in the manifest`,
        );
      }
    }
  }

  // 8. Every rubric criterion's skill_axis is in the original spec's skill_axes
  const specAxes = new Set<string>(spec.skill_axes);
  for (const criterion of design.evaluation_rubric) {
    if (!specAxes.has(criterion.skill_axis)) {
      errors.push(
        `Rubric criterion "${criterion.criterion}" uses skill axis "${criterion.skill_axis}" which is not in the spec`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
