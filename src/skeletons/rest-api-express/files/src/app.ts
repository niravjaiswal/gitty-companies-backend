import express from 'express';
import { tasksRouter } from './routes/tasks.js';
import { projectsRouter } from './routes/projects.js';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/tasks', tasksRouter);
app.use('/projects', projectsRouter);

export { app };
