import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';

describe('Tasks API', () => {
  describe('GET /tasks', () => {
    it('returns all seeded tasks', async () => {
      const res = await request(app).get('/tasks');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('GET /tasks/:id', () => {
    it('returns a specific task', async () => {
      const res = await request(app).get('/tasks/1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', '1');
      expect(res.body).toHaveProperty('title');
      expect(res.body).toHaveProperty('status');
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
      expect(res.body).toHaveProperty('createdAt');
      expect(res.body).toHaveProperty('updatedAt');
    });

    it('returns 400 for missing title', async () => {
      const res = await request(app)
        .post('/tasks')
        .send({ description: 'No title provided' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('PUT /tasks/:id', () => {
    it('updates task fields', async () => {
      const res = await request(app)
        .put('/tasks/1')
        .send({ title: 'Updated title' });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated title');
      expect(res.body.id).toBe('1');
    });

    it('returns 404 for unknown id', async () => {
      const res = await request(app)
        .put('/tasks/999')
        .send({ title: 'Does not matter' });
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('DELETE /tasks/:id', () => {
    it('deletes a task', async () => {
      // Create a task to delete
      const created = await request(app)
        .post('/tasks')
        .send({ title: 'To be deleted' });
      const id = created.body.id;

      const res = await request(app).delete(`/tasks/${id}`);
      expect(res.status).toBe(204);

      // Verify it's gone
      const check = await request(app).get(`/tasks/${id}`);
      expect(check.status).toBe(404);
    });

    it('returns 404 for unknown id', async () => {
      const res = await request(app).delete('/tasks/999');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });
  });
});
