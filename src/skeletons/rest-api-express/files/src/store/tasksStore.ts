import type { Task, TaskStatus } from '../types.js';

const tasks = new Map<string, Task>();
let nextId = 1;

function nowIso(): string {
  return new Date().toISOString();
}

export function listTasks(filter?: { status?: TaskStatus; projectId?: string | null }): Task[] {
  const all = Array.from(tasks.values());
  if (!filter) return all;
  return all.filter((t) => {
    if (filter.status !== undefined && t.status !== filter.status) return false;
    if (filter.projectId !== undefined && t.projectId !== filter.projectId) return false;
    return true;
  });
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

export function createTask(input: {
  title: string;
  description?: string;
  status?: TaskStatus;
  projectId?: string | null;
}): Task {
  const id = String(nextId++);
  const now = nowIso();
  const task: Task = {
    id,
    projectId: input.projectId ?? null,
    title: input.title,
    description: input.description ?? '',
    status: input.status ?? 'todo',
    createdAt: now,
    updatedAt: now,
  };
  tasks.set(id, task);
  return task;
}

export function updateTask(
  id: string,
  patch: Partial<Pick<Task, 'title' | 'description' | 'status' | 'projectId'>>,
): Task | undefined {
  const task = tasks.get(id);
  if (!task) return undefined;
  if (patch.title !== undefined) task.title = patch.title;
  if (patch.description !== undefined) task.description = patch.description;
  if (patch.status !== undefined) task.status = patch.status;
  if (patch.projectId !== undefined) task.projectId = patch.projectId;
  task.updatedAt = nowIso();
  return task;
}

export function deleteTask(id: string): boolean {
  return tasks.delete(id);
}

export function clearTasks(): void {
  tasks.clear();
  nextId = 1;
}

function seed() {
  createTask({ title: 'Set up CI pipeline', description: 'Configure GitHub Actions', status: 'done' });
  createTask({ title: 'Write API documentation', description: 'Document all endpoints', status: 'in_progress' });
  createTask({ title: 'Add rate limiting', description: 'Implement middleware', status: 'todo' });
}

seed();
