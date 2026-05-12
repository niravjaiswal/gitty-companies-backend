import { Router } from 'express';
import * as projectService from '../services/projectService.js';
import {
  CreateProjectSchema,
  ProjectStatusSchema,
  UpdateProjectSchema,
  runZodValidation,
} from '../validation/schemas.js';
import type { ProjectStatus } from '../types.js';

export const projectsRouter = Router();

projectsRouter.get('/', (req, res) => {
  const statusParam = typeof req.query.status === 'string' ? req.query.status : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;

  let status: ProjectStatus | undefined;
  if (statusParam !== undefined) {
    const parsed = ProjectStatusSchema.safeParse(statusParam);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid status filter' });
      return;
    }
    status = parsed.data as ProjectStatus;
  }

  res.json(projectService.listProjects({ status, search }));
});

projectsRouter.get('/:id', (req, res) => {
  const result = projectService.getProject(req.params.id);
  if (!result.ok) {
    res.status(404).json({ error: 'project not found' });
    return;
  }
  res.json(result.value);
});

projectsRouter.post('/', (req, res) => {
  const validated = runZodValidation(CreateProjectSchema, req.body);
  if (!validated.ok) {
    res.status(400).json({ error: 'validation failed', details: validated.errors });
    return;
  }
  const result = projectService.createProject(validated.value);
  if (!result.ok) {
    res.status(400).json({ error: 'failed to create project' });
    return;
  }
  res.status(201).json(result.value);
});

projectsRouter.put('/:id', (req, res) => {
  const validated = runZodValidation(UpdateProjectSchema, req.body);
  if (!validated.ok) {
    res.status(400).json({ error: 'validation failed', details: validated.errors });
    return;
  }
  const result = projectService.updateProject(req.params.id, validated.value);
  if (!result.ok) {
    res.status(404).json({ error: 'project not found' });
    return;
  }
  res.json(result.value);
});

projectsRouter.delete('/:id', (req, res) => {
  const result = projectService.deleteProject(req.params.id);
  if (!result.ok) {
    if (result.error.kind === 'not_found') {
      res.status(404).json({ error: 'project not found' });
      return;
    }
    res.status(409).json({ error: result.error.message });
    return;
  }
  res.status(204).end();
});
