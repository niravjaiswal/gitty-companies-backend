import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { clearProjects, createProject } from '../store/projectsStore.js';
import { clearTasks } from '../store/tasksStore.js';

beforeEach(() => {
  clearProjects();
  clearTasks();
  createProject({ name: 'Platform Hardening', description: 'Reliability', status: 'active' });
  createProject({ name: 'Q3 Launch', description: 'Marketing site refresh', status: 'planning' });
});

describe('GET /projects', () => {
  it('returns all projects', async () => {
    const res = await request(app).get('/projects');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it('filters by status', async () => {
    const res = await request(app).get('/projects?status=active');
    expect(res.status).toBe(200);
    expect(res.body.every((p: { status: string }) => p.status === 'active')).toBe(true);
  });

  it('rejects invalid status filter', async () => {
    const res = await request(app).get('/projects?status=bogus');
    expect(res.status).toBe(400);
  });

  it('searches by keyword', async () => {
    const res = await request(app).get('/projects?search=marketing');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });
});

describe('GET /projects/:id', () => {
  it('returns a project', async () => {
    const res = await request(app).get('/projects/1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', '1');
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('status');
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/projects/999');
    expect(res.status).toBe(404);
  });
});

describe('POST /projects', () => {
  it('creates a new project', async () => {
    const res = await request(app).post('/projects').send({ name: 'New project' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('New project');
    expect(res.body.status).toBe('planning');
  });

  it('returns 400 for missing name', async () => {
    const res = await request(app).post('/projects').send({ description: 'no name' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('details');
  });

  it('returns 400 for invalid status', async () => {
    const res = await request(app).post('/projects').send({ name: 'x', status: 'bogus' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /projects/:id', () => {
  it('updates project fields', async () => {
    const res = await request(app).put('/projects/1').send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed');
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).put('/projects/999').send({ name: 'no matter' });
    expect(res.status).toBe(404);
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app).put('/projects/1').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid status enum', async () => {
    const res = await request(app).put('/projects/1').send({ status: 'bogus' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /projects/:id', () => {
  it('deletes a project with no linked tasks', async () => {
    const created = await request(app).post('/projects').send({ name: 'temp' });
    const res = await request(app).delete(`/projects/${created.body.id}`);
    expect(res.status).toBe(204);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).delete('/projects/999');
    expect(res.status).toBe(404);
  });

  it('returns 409 when linked tasks exist', async () => {
    const project = await request(app).post('/projects').send({ name: 'has-tasks' });
    await request(app).post('/tasks').send({ title: 't', projectId: project.body.id });
    const res = await request(app).delete(`/projects/${project.body.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('linked task');
  });
});
