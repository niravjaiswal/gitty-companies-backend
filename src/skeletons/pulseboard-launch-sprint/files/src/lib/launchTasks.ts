import type { LaunchStatus, LaunchTask } from "../App";

export type LaunchFilter = "all" | LaunchStatus;

export interface DraftTask {
  title: string;
  owner: string;
  lane: string;
  status: string;
}

export interface ValidationFailure {
  ok: false;
  error: string;
}
export interface ValidationSuccess {
  ok: true;
  value: { title: string; owner: string; lane: string; status: LaunchStatus };
}
export type ValidationResult = ValidationFailure | ValidationSuccess;

const STATUS_VALUES: LaunchStatus[] = ["ready", "watch", "blocked"];

export function validateDraftTask(input: DraftTask): ValidationResult {
  const title = input.title.trim();
  const owner = input.owner.trim();
  const lane = input.lane.trim();

  if (!title || !owner || !lane) {
    return { ok: false, error: "Title, owner, and lane are required." };
  }

  const status = STATUS_VALUES.includes(input.status as LaunchStatus)
    ? (input.status as LaunchStatus)
    : "watch";

  return { ok: true, value: { title, owner, lane, status } };
}

export function nextTaskId(tasks: LaunchTask[]): number {
  if (tasks.length === 0) return 1;
  return Math.max(0, ...tasks.map((t) => t.id)) + 1;
}

export function applyTaskFilter(
  tasks: LaunchTask[],
  filter: LaunchFilter,
  query: string,
): LaunchTask[] {
  const normalizedQuery = query.trim().toLowerCase();
  return tasks.filter((task) => {
    if (filter !== "all" && task.status !== filter) return false;
    if (!normalizedQuery) return true;
    const haystack = [task.title, task.owner, task.lane].join(" ").toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function computeLaunchScore(tasks: LaunchTask[]): {
  readyCount: number;
  totalCount: number;
  launchPercent: number;
} {
  const totalCount = tasks.length;
  const readyCount = tasks.filter((t) => t.status === "ready").length;
  const launchPercent = totalCount === 0 ? 0 : Math.round((readyCount / totalCount) * 100);
  return { readyCount, totalCount, launchPercent };
}

export function statusLabel(status: LaunchStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "watch":
      return "Watch";
    case "blocked":
      return "Blocked";
  }
}
