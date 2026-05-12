import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { clearTasks, createTask } from '../store/tasksStore.js';

beforeEach(() => {
  clearTasks();
  createTask({ title: 'Set up CI pipeline', description: 'Configure GitHub Actions', status: 'done' });
  createTask({ title: 'Write API documentation', description: 'Document all endpoints', status: 'in_progress' });
  createTask({ title: 'Add rate limiting', description: 'Implement middleware', status: 'todo' });
});

describe('GET /tasks', () => {
  it('returns all seeded tasks', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(3);
  });

  it('filters by status', async () => {
    const res = await request(app).get('/tasks?status=todo');
    expect(res.status).toBe(200);
    expect(res.body.every((t: { status: string }) => t.status === 'todo')).toBe(true);
  });

  it('rejects invalid status filter', async () => {
    const res = await request(app).get('/tasks?status=bogus');
    expect(res.status).toBe(400);
  });

  it('searches by keyword in title and description', async () => {
    const res = await request(app).get('/tasks?search=rate');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].title).toContain('rate limiting');
  });

  it('returns empty array when no tasks match search', async () => {
    const res = await request(app).get('/tasks?search=xyznotfound');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /tasks/:id', () => {
  it('returns a specific task', async () => {
    const res = await request(app).get('/tasks/1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', '1');
    expect(res.body).toHaveProperty('title');
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('projectId');
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/tasks/999');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

describe('POST /tasks', () => {
  it('creates a new task', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'New task', description: 'A test task' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.title).toBe('New task');
    expect(res.body.status).toBe('todo');
    expect(res.body.projectId).toBe(null);
    expect(res.body).toHaveProperty('createdAt');
    expect(res.body).toHaveProperty('updatedAt');
  });

  it('returns 400 for missing title', async () => {
    const res = await request(app).post('/tasks').send({ description: 'no title' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('details');
  });

  it('returns 400 for empty title', async () => {
    const res = await request(app).post('/tasks').send({ title: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid status enum', async () => {
    const res = await request(app).post('/tasks').send({ title: 'x', status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for unknown projectId reference', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'x', projectId: 'does-not-exist' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /tasks/:id', () => {
  it('updates task fields', async () => {
    const res = await request(app).put('/tasks/1').send({ title: 'Updated title' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated title');
    expect(res.body.id).toBe('1');
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).put('/tasks/999').send({ title: 'no matter' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid status enum', async () => {
    const res = await request(app).put('/tasks/1').send({ status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when no fields are provided', async () => {
    const res = await request(app).put('/tasks/1').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty title', async () => {
    const res = await request(app).put('/tasks/1').send({ title: '' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /tasks/:id', () => {
  it('deletes a task', async () => {
    const created = await request(app).post('/tasks').send({ title: 'To be deleted' });
    const id = created.body.id;
    const res = await request(app).delete(`/tasks/${id}`);
    expect(res.status).toBe(204);
    const check = await request(app).get(`/tasks/${id}`);
    expect(check.status).toBe(404);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).delete('/tasks/999');
    expect(res.status).toBe(404);
  });
});
