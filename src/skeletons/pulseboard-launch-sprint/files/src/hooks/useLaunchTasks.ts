import { useCallback, useMemo, useState } from "react";
import type { LaunchTask } from "../App";
import {
  applyTaskFilter,
  computeLaunchScore,
  nextTaskId,
  validateDraftTask,
  type DraftTask,
  type LaunchFilter,
} from "../lib/launchTasks";

export interface UseLaunchTasksApi {
  tasks: LaunchTask[];
  filter: LaunchFilter;
  query: string;
  filteredTasks: LaunchTask[];
  composerError: string;
  readyCount: number;
  totalCount: number;
  launchPercent: number;
  setFilter: (filter: LaunchFilter) => void;
  setQuery: (query: string) => void;
  addTask: (input: DraftTask) => boolean;
}

export function useLaunchTasks(initial: LaunchTask[]): UseLaunchTasksApi {
  const [tasks, setTasks] = useState<LaunchTask[]>(initial);
  const [filter, setFilter] = useState<LaunchFilter>("all");
  const [query, setQuery] = useState("");
  const [composerError, setComposerError] = useState("");

  const filteredTasks = useMemo(
    () => applyTaskFilter(tasks, filter, query),
    [tasks, filter, query],
  );

  const { readyCount, totalCount, launchPercent } = useMemo(
    () => computeLaunchScore(tasks),
    [tasks],
  );

  const addTask = useCallback((input: DraftTask): boolean => {
    const validated = validateDraftTask(input);
    if (!validated.ok) {
      setComposerError(validated.error);
      return false;
    }
    setComposerError("");
    setTasks((prev) => [
      ...prev,
      { id: nextTaskId(prev), ...validated.value },
    ]);
    return true;
  }, []);

  return {
    tasks,
    filter,
    query,
    filteredTasks,
    composerError,
    readyCount,
    totalCount,
    launchPercent,
    setFilter,
    setQuery,
    addTask,
  };
}
