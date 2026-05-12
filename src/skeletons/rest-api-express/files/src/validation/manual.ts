import { TASK_STATUSES, type Task, type TaskStatus } from '../types.js';

export type ManualValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string> };

export function validateCreateTask(input: unknown): ManualValidationResult<{
  title: string;
  description?: string;
  status?: TaskStatus;
  projectId?: string | null;
}> {
  const errors: Record<string, string> = {};
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: { _root: 'body must be an object' } };
  }
  const body = input as Record<string, unknown>;
  if (typeof body.title !== 'string' || body.title.length === 0) {
    errors.title = 'title is required';
  }
  if (body.description !== undefined && typeof body.description !== 'string') {
    errors.description = 'description must be a string';
  }
  if (body.status !== undefined && !TASK_STATUSES.includes(body.status as TaskStatus)) {
    errors.status = `status must be one of: ${TASK_STATUSES.join(', ')}`;
  }
  if (body.projectId !== undefined && body.projectId !== null && typeof body.projectId !== 'string') {
    errors.projectId = 'projectId must be a string or null';
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title: body.title as string,
      description: body.description as string | undefined,
      status: body.status as TaskStatus | undefined,
      projectId: body.projectId as string | null | undefined,
    },
  };
}

export function validateUpdateTask(input: unknown): ManualValidationResult<
  Partial<Pick<Task, 'title' | 'description' | 'status' | 'projectId'>>
> {
  const errors: Record<string, string> = {};
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: { _root: 'body must be an object' } };
  }
  const body = input as Record<string, unknown>;
  const patch: Partial<Pick<Task, 'title' | 'description' | 'status' | 'projectId'>> = {};
  let provided = 0;
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.length === 0) {
      errors.title = 'title must be a non-empty string';
    } else {
      patch.title = body.title;
      provided++;
    }
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') errors.description = 'description must be a string';
    else {
      patch.description = body.description;
      provided++;
    }
  }
  if (body.status !== undefined) {
    if (!TASK_STATUSES.includes(body.status as TaskStatus)) {
      errors.status = `status must be one of: ${TASK_STATUSES.join(', ')}`;
    } else {
      patch.status = body.status as TaskStatus;
      provided++;
    }
  }
  if (body.projectId !== undefined) {
    if (body.projectId !== null && typeof body.projectId !== 'string') {
      errors.projectId = 'projectId must be a string or null';
    } else {
      patch.projectId = body.projectId as string | null;
      provided++;
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  if (provided === 0) {
    return { ok: false, errors: { _root: 'at least one field is required' } };
  }
  return { ok: true, value: patch };
}
