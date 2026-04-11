import { Router } from 'express';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done';
  createdAt: string;
  updatedAt: string;
}

const tasks = new Map<string, Task>();
let nextId = 1;

function seedTasks() {
  const now = new Date().toISOString();
  const seed: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>[] = [
    { title: 'Set up CI pipeline', description: 'Configure GitHub Actions for the project', status: 'done' },
    { title: 'Write API documentation', description: 'Document all REST endpoints', status: 'in_progress' },
    { title: 'Add rate limiting', description: 'Implement rate limiting middleware', status: 'todo' },
  ];
  for (const t of seed) {
    const id = String(nextId++);
    tasks.set(id, { ...t, id, createdAt: now, updatedAt: now });
  }
}

seedTasks();

export const tasksRouter = Router();

tasksRouter.get('/', (_req, res) => {
  res.json(Array.from(tasks.values()));
});

tasksRouter.get('/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(task);
});

tasksRouter.post('/', (req, res) => {
  const { title, description, status } = req.body;
  if (!title || typeof title !== 'string') {
    res.status(400).json({ error: 'Title is required' });
    return;
  }
  const id = String(nextId++);
  const now = new Date().toISOString();
  const task: Task = {
    id,
    title,
    description: description ?? '',
    status: status ?? 'todo',
    createdAt: now,
    updatedAt: now,
  };
  tasks.set(id, task);
  res.status(201).json(task);
});

// TODO: This endpoint accepts any update without validation.
// The candidate should add:
// - Status validation (must be 'todo', 'in_progress', or 'done')
// - Check that at least one valid field is provided
// - Return 400 for invalid input
tasksRouter.put('/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const { title, description, status } = req.body;
  if (title !== undefined) task.title = title;
  if (description !== undefined) task.description = description;
  if (status !== undefined) task.status = status;
  task.updatedAt = new Date().toISOString();
  res.json(task);
});

tasksRouter.delete('/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  tasks.delete(req.params.id);
  res.status(204).end();
});
