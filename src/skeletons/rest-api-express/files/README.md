# Task Board API

A task management REST API built with Express and TypeScript.

## Getting started

```bash
npm install
npm run dev    # Start dev server with hot reload
npm test       # Run test suite
```

## Overview

This API manages tasks with full CRUD operations. The server runs on port 3000 by default (configurable via the `PORT` environment variable).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| GET | /tasks | List all tasks |
| GET | /tasks/:id | Get a task by ID |
| POST | /tasks | Create a new task |
| PUT | /tasks/:id | Update a task |
| DELETE | /tasks/:id | Delete a task |

## Task shape

```json
{
  "id": "1",
  "title": "Set up CI pipeline",
  "description": "Configure GitHub Actions for the project",
  "status": "todo",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

Valid status values: `todo`, `in_progress`, `done`.

## Your task

The `PUT /tasks/:id` endpoint currently accepts any update without validation. Your job is to improve it:

1. **Validate status** -- if a `status` field is provided, it must be one of `todo`, `in_progress`, or `done`. Return 400 for invalid values.
2. **Require at least one field** -- if the request body contains none of `title`, `description`, or `status`, return 400.
3. **Add query parameter filtering** to `GET /tasks` -- support `?status=todo` and `?search=keyword` (searches title and description).

Run `npm test` to verify your changes don't break existing functionality.
