export type TaskStatus = 'todo' | 'in_progress' | 'done';
export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done'];

export type ProjectStatus = 'planning' | 'active' | 'archived';
export const PROJECT_STATUSES: ProjectStatus[] = ['planning', 'active', 'archived'];

export interface Task {
  id: string;
  projectId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ApiError {
  error: string;
  details?: Record<string, string>;
}
