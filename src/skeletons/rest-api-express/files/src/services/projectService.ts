import * as projectsStore from '../store/projectsStore.js';
import * as tasksStore from '../store/tasksStore.js';
import type { Project, ProjectStatus } from '../types.js';
import type { ServiceResult } from './taskService.js';

export interface ProjectListFilter {
  status?: ProjectStatus;
  search?: string;
}

export function listProjects(filter: ProjectListFilter): Project[] {
  const base = projectsStore.listProjects({ status: filter.status });
  if (!filter.search) return base;
  const needle = filter.search.toLowerCase();
  return base.filter(
    (p) => p.name.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle),
  );
}

export function getProject(id: string): ServiceResult<Project> {
  const p = projectsStore.getProject(id);
  if (!p) return { ok: false, error: { kind: 'not_found', resource: 'project', id } };
  return { ok: true, value: p };
}

export function createProject(input: {
  name: string;
  description?: string;
  status?: ProjectStatus;
}): ServiceResult<Project> {
  return { ok: true, value: projectsStore.createProject(input) };
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'description' | 'status'>>,
): ServiceResult<Project> {
  const updated = projectsStore.updateProject(id, patch);
  if (!updated) return { ok: false, error: { kind: 'not_found', resource: 'project', id } };
  return { ok: true, value: updated };
}

export function deleteProject(id: string): ServiceResult<null> {
  const project = projectsStore.getProject(id);
  if (!project) return { ok: false, error: { kind: 'not_found', resource: 'project', id } };
  const linkedTasks = tasksStore.listTasks({ projectId: id });
  if (linkedTasks.length > 0) {
    return {
      ok: false,
      error: { kind: 'conflict', message: `project has ${linkedTasks.length} linked task(s)` },
    };
  }
  projectsStore.deleteProject(id);
  return { ok: true, value: null };
}
