import type { Project, ProjectStatus } from '../types.js';

const projects = new Map<string, Project>();
let nextId = 1;

function nowIso(): string {
  return new Date().toISOString();
}

export function listProjects(filter?: { status?: ProjectStatus }): Project[] {
  const all = Array.from(projects.values());
  if (!filter?.status) return all;
  return all.filter((p) => p.status === filter.status);
}

export function getProject(id: string): Project | undefined {
  return projects.get(id);
}

export function createProject(input: {
  name: string;
  description?: string;
  status?: ProjectStatus;
}): Project {
  const id = String(nextId++);
  const now = nowIso();
  const project: Project = {
    id,
    name: input.name,
    description: input.description ?? '',
    status: input.status ?? 'planning',
    createdAt: now,
    updatedAt: now,
  };
  projects.set(id, project);
  return project;
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'description' | 'status'>>,
): Project | undefined {
  const project = projects.get(id);
  if (!project) return undefined;
  if (patch.name !== undefined) project.name = patch.name;
  if (patch.description !== undefined) project.description = patch.description;
  if (patch.status !== undefined) project.status = patch.status;
  project.updatedAt = nowIso();
  return project;
}

export function deleteProject(id: string): boolean {
  return projects.delete(id);
}

export function clearProjects(): void {
  projects.clear();
  nextId = 1;
}

function seed() {
  createProject({ name: 'Platform Hardening', description: 'Reliability and observability work', status: 'active' });
  createProject({ name: 'Q3 Launch', description: 'Marketing site refresh', status: 'planning' });
}

seed();
