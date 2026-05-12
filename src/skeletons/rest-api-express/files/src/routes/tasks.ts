import { Router } from 'express';
import * as taskService from '../services/taskService.js';
import { validateCreateTask, validateUpdateTask } from '../validation/manual.js';
import { TASK_STATUSES, type TaskStatus } from '../types.js';

export const tasksRouter = Router();

tasksRouter.get('/', (req, res) => {
  const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const projectIdParam = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;

  let status: TaskStatus | undefined;
  if (statusParam !== undefined) {
    if (!TASK_STATUSES.includes(statusParam as TaskStatus)) {
      res.status(400).json({ error: `status must be one of: ${TASK_STATUSES.join(', ')}` });
      return;
    }
    status = statusParam as TaskStatus;
  }

  res.json(taskService.listTasks({ status, search, projectId: projectIdParam }));
});

tasksRouter.get('/:id', (req, res) => {
  const result = taskService.getTask(req.params.id);
  if (!result.ok) {
    res.status(404).json({ error: 'task not found' });
    return;
  }
  res.json(result.value);
});

tasksRouter.post('/', (req, res) => {
  const validated = validateCreateTask(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: 'validation failed', details: validated.errors });
    return;
  }
  const result = taskService.createTask(validated.value);
  if (!result.ok) {
    if (result.error.kind === 'not_found') {
      res.status(400).json({ error: `referenced ${result.error.resource} not found` });
      return;
    }
    res.status(409).json({ error: result.error.message });
    return;
  }
  res.status(201).json(result.value);
});

// TODO: candidate work — see README.
// The PUT endpoint currently delegates to the manual validator and lacks the
// project-cross-reference checks that the projects router enforces via zod.
// You need to consolidate validation into ONE pattern across both routers,
// then make this endpoint behave consistently with PUT /projects/:id.
tasksRouter.put('/:id', (req, res) => {
  const validated = validateUpdateTask(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: 'validation failed', details: validated.errors });
    return;
  }
  const result = taskService.updateTask(req.params.id, validated.value);
  if (!result.ok) {
    if (result.error.kind === 'not_found') {
      res.status(404).json({ error: 'task not found' });
      return;
    }
    res.status(409).json({ error: result.error.message });
    return;
  }
  res.json(result.value);
});

tasksRouter.delete('/:id', (req, res) => {
  const result = taskService.deleteTask(req.params.id);
  if (!result.ok) {
    res.status(404).json({ error: 'task not found' });
    return;
  }
  res.status(204).end();
});
