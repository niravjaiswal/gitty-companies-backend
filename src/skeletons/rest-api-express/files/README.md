# Task Board API

A task management REST API built with Express and TypeScript.

## Getting started

```bash
npm install
npm run dev    # Start dev server with hot reload
npm test       # Run test suite
```

## Overview

This API manages two related resources:

- **Tasks** — units of work, optionally linked to a project
- **Projects** — groupings of tasks

Both resources support full CRUD plus list filtering (`?status=...`, `?search=...`).

## Architecture

```
src/
  routes/         HTTP layer (express routers)
  services/       business logic (cross-resource rules, sorting, search)
  store/          in-memory data layer (Map-backed)
  validation/     request body validation
    schemas.ts    zod schemas + runZodValidation helper
    manual.ts     hand-rolled if-check validators
  types.ts        domain types and status enums
```

The data layer is intentionally in-memory — restarting the server resets state. Tests rely on `clearTasks()` / `clearProjects()` between cases.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| GET | /tasks | List tasks (`?status=`, `?search=`, `?projectId=`) |
| GET | /tasks/:id | Get one task |
| POST | /tasks | Create a task |
| PUT | /tasks/:id | Update a task |
| DELETE | /tasks/:id | Delete a task |
| GET | /projects | List projects (`?status=`, `?search=`) |
| GET | /projects/:id | Get one project |
| POST | /projects | Create a project |
| PUT | /projects/:id | Update a project |
| DELETE | /projects/:id | Delete a project (409 if linked tasks exist) |

Status enums:

- task: `todo`, `in_progress`, `done`
- project: `planning`, `active`, `archived`

## Your task — consolidate validation

The two routers were written by different people and validate request bodies in two different ways:

- `routes/projects.ts` uses **zod** schemas via `validation/schemas.ts`
- `routes/tasks.ts` uses **hand-rolled** validators in `validation/manual.ts`

Both happen to pass the existing tests, but the codebase has a real architectural smell — two patterns doing the same job, with subtly different error response shapes and key naming (`_root` vs zod path strings vs ad-hoc field names).

### What you need to do

1. **Pick one validation pattern** (zod *or* manual — your call) and migrate the other router to use it. The chosen pattern's helper should be the only validation entry point both routers call.
2. **Unify the error response shape** so that for the same kind of failure (empty body, invalid enum, missing required field), `/tasks` and `/projects` return identical body structure.
3. **Audit the routes for inconsistent error mapping.** Look at how each router translates service-layer errors (`{ kind: 'not_found', resource: ... }`) into HTTP responses. They do not match.
4. **Delete the now-unused validator file** once migration is complete.

You'll know you're finished when:

- `src/__tests__/tasks.test.ts` passes
- `src/__tests__/projects.test.ts` passes
- `src/__tests__/consistency.test.ts` passes (this is the contract)
- `npm run build` produces no type errors
- The codebase reads as if one person wrote both routers

### What we're looking for

There is no single "correct" answer to which pattern wins. We care about:

- **Internal consistency** — once you pick a pattern, the codebase should look like one person wrote it
- **Error response design** — pick a shape, document it, apply it everywhere
- **Tests as a contract** — `consistency.test.ts` pins the cross-resource invariant; do not edit it to make it pass
- **Service-layer integrity** — the service layer already returns structured errors with `kind` and `resource`; the route layer should translate them faithfully

## Commands

```bash
npm install
npm run dev
npm test
npm run build
```
