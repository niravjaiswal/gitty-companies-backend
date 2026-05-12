import * as tasksStore from '../store/tasksStore.js';
import { getProject } from '../store/projectsStore.js';
import type { Task, TaskStatus } from '../types.js';

export type ServiceError =
  | { kind: 'not_found'; resource: string; id: string }
  | { kind: 'conflict'; message: string };

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: ServiceError };

export interface TaskListFilter {
  status?: TaskStatus;
  projectId?: string | null;
  search?: string;
}

export function listTasks(filter: TaskListFilter): Task[] {
  const base = tasksStore.listTasks({ status: filter.status, projectId: filter.projectId });
  if (!filter.search) return base;
  const needle = filter.search.toLowerCase();
  return base.filter(
    (t) => t.title.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle),
  );
}

export function getTask(id: string): ServiceResult<Task> {
  const t = tasksStore.getTask(id);
  if (!t) return { ok: false, error: { kind: 'not_found', resource: 'task', id } };
  return { ok: true, value: t };
}

export function createTask(input: {
  title: string;
  description?: string;
  status?: TaskStatus;
  projectId?: string | null;
}): ServiceResult<Task> {
  if (input.projectId) {
    const project = getProject(input.projectId);
    if (!project) {
      return { ok: false, error: { kind: 'not_found', resource: 'project', id: input.projectId } };
    }
    if (project.status === 'archived') {
      return { ok: false, error: { kind: 'conflict', message: 'cannot attach task to archived project' } };
    }
  }
  return { ok: true, value: tasksStore.createTask(input) };
}

export function updateTask(
  id: string,
  patch: Partial<Pick<Task, 'title' | 'description' | 'status' | 'projectId'>>,
): ServiceResult<Task> {
  const existing = tasksStore.getTask(id);
  if (!existing) return { ok: false, error: { kind: 'not_found', resource: 'task', id } };
  if (patch.projectId) {
    const project = getProject(patch.projectId);
    if (!project) {
      return { ok: false, error: { kind: 'not_found', resource: 'project', id: patch.projectId } };
    }
    if (project.status === 'archived') {
      return { ok: false, error: { kind: 'conflict', message: 'cannot attach task to archived project' } };
    }
  }
  const updated = tasksStore.updateTask(id, patch);
  if (!updated) return { ok: false, error: { kind: 'not_found', resource: 'task', id } };
  return { ok: true, value: updated };
}

export function deleteTask(id: string): ServiceResult<null> {
  const ok = tasksStore.deleteTask(id);
  if (!ok) return { ok: false, error: { kind: 'not_found', resource: 'task', id } };
  return { ok: true, value: null };
}
