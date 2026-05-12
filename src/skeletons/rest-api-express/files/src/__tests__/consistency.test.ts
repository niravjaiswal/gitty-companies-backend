import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { clearProjects, createProject } from '../store/projectsStore.js';
import { clearTasks, createTask } from '../store/tasksStore.js';

beforeEach(() => {
  clearProjects();
  clearTasks();
  createProject({ name: 'Platform', status: 'active' });
  createTask({ title: 't', status: 'todo' });
});

describe('cross-resource validation consistency', () => {
  // These tests assert the SHAPE of the validation response is the same across
  // /tasks and /projects. They are the consistency contract the candidate must
  // honor while consolidating validation into one pattern.

  it('both routers reject empty body on PUT with 400 + details', async () => {
    const t = await request(app).put('/tasks/1').send({});
    const p = await request(app).put('/projects/1').send({});
    expect(t.status).toBe(400);
    expect(p.status).toBe(400);
    // The candidate should make the response shapes match.
    // Currently they differ: tasks uses manual.ts ({_root: ...}), projects uses zod.
    expect(typeof t.body.error).toBe('string');
    expect(typeof p.body.error).toBe('string');
  });

  it('both routers reject invalid status enum on PUT with 400', async () => {
    const t = await request(app).put('/tasks/1').send({ status: 'bogus' });
    const p = await request(app).put('/projects/1').send({ status: 'bogus' });
    expect(t.status).toBe(400);
    expect(p.status).toBe(400);
  });

  it('both routers return 404 on PUT for unknown id', async () => {
    const t = await request(app).put('/tasks/999').send({ title: 'x' });
    const p = await request(app).put('/projects/999').send({ name: 'x' });
    expect(t.status).toBe(404);
    expect(p.status).toBe(404);
  });

  it('both routers return validation details under a `details` key', async () => {
    const t = await request(app).post('/tasks').send({ title: '' });
    const p = await request(app).post('/projects').send({ name: '' });
    expect(t.status).toBe(400);
    expect(p.status).toBe(400);
    // Currently both happen to set `details`, but the structure differs.
    // The candidate should make the structure identical.
    expect(t.body).toHaveProperty('details');
    expect(p.body).toHaveProperty('details');
  });
});
