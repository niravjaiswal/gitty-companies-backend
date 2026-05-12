import { describe, expect, it } from "vitest";
import {
  applyTaskFilter,
  computeLaunchScore,
  nextTaskId,
  statusLabel,
  validateDraftTask,
} from "../launchTasks";
import type { LaunchTask } from "../../App";

function makeTask(overrides: Partial<LaunchTask> = {}): LaunchTask {
  return {
    id: 1,
    title: "Sample task",
    owner: "Mina",
    lane: "Brand",
    status: "ready",
    ...overrides,
  };
}

describe("validateDraftTask", () => {
  it("returns ok with trimmed fields when all required fields are present", () => {
    const result = validateDraftTask({
      title: "  Ship copy  ",
      owner: " Mina ",
      lane: "Brand",
      status: "ready",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        title: "Ship copy",
        owner: "Mina",
        lane: "Brand",
        status: "ready",
      });
    }
  });

  it("rejects an empty title", () => {
    const result = validateDraftTask({
      title: "",
      owner: "Mina",
      lane: "Brand",
      status: "ready",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects whitespace-only owner as a missing field", () => {
    const result = validateDraftTask({
      title: "Ship",
      owner: "   ",
      lane: "Brand",
      status: "ready",
    });
    expect(result.ok).toBe(false);
  });

  it("falls back to watch when status is not in the enum", () => {
    const result = validateDraftTask({
      title: "Ship",
      owner: "Mina",
      lane: "Brand",
      status: "bogus",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("watch");
    }
  });
});

describe("nextTaskId", () => {
  it("returns 1 for an empty list", () => {
    expect(nextTaskId([])).toBe(1);
  });

  it("returns max id + 1 for a non-empty list", () => {
    expect(nextTaskId([makeTask({ id: 4 }), makeTask({ id: 7 }), makeTask({ id: 2 })])).toBe(8);
  });

  it("handles duplicate ids without going backwards", () => {
    expect(nextTaskId([makeTask({ id: 5 }), makeTask({ id: 5 })])).toBe(6);
  });
});

describe("applyTaskFilter — boundary and conflict cases", () => {
  const tasks: LaunchTask[] = [
    makeTask({ id: 1, title: "Ship hero", status: "ready" }),
    makeTask({ id: 2, title: "Validate billing", status: "watch", owner: "Ilya" }),
    makeTask({ id: 3, title: "Mobile regressions", status: "blocked", owner: "Jules" }),
  ];

  it("returns all tasks when filter is all and query is empty", () => {
    expect(applyTaskFilter(tasks, "all", "")).toHaveLength(3);
  });

  it("filters by status", () => {
    expect(applyTaskFilter(tasks, "blocked", "")).toEqual([tasks[2]]);
  });

  it("treats whitespace-only queries as empty", () => {
    expect(applyTaskFilter(tasks, "all", "   ")).toHaveLength(3);
  });

  it("composes status filter and search — both must match", () => {
    expect(applyTaskFilter(tasks, "watch", "billing")).toEqual([tasks[1]]);
    expect(applyTaskFilter(tasks, "ready", "billing")).toEqual([]);
  });

  it("is case-insensitive on the search needle", () => {
    expect(applyTaskFilter(tasks, "all", "JULES")).toEqual([tasks[2]]);
  });

  it("returns empty when no task matches an invalid combination", () => {
    expect(applyTaskFilter(tasks, "ready", "missing-needle")).toEqual([]);
  });
});

describe("computeLaunchScore — boundary cases", () => {
  it("returns zero percent for an empty task list (no division by zero)", () => {
    expect(computeLaunchScore([])).toEqual({
      readyCount: 0,
      totalCount: 0,
      launchPercent: 0,
    });
  });

  it("returns 100 when every task is ready", () => {
    const tasks = [makeTask({ id: 1 }), makeTask({ id: 2 }), makeTask({ id: 3 })];
    expect(computeLaunchScore(tasks).launchPercent).toBe(100);
  });

  it("rounds the percentage to the nearest integer", () => {
    const tasks = [
      makeTask({ id: 1, status: "ready" }),
      makeTask({ id: 2, status: "ready" }),
      makeTask({ id: 3, status: "watch" }),
    ];
    expect(computeLaunchScore(tasks).launchPercent).toBe(67);
  });
});

describe("statusLabel", () => {
  it("returns the canonical label for each status", () => {
    expect(statusLabel("ready")).toBe("Ready");
    expect(statusLabel("watch")).toBe("Watch");
    expect(statusLabel("blocked")).toBe("Blocked");
  });
});
