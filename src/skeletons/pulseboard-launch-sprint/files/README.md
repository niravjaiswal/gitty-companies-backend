# Pulseboard Launch Sprint

A polished React + TypeScript assessment built as a real Vite app with a missing task composer feature for the candidate to finish.

## Feature to build

Implement the missing task composer so candidates can add a launch task into the real dashboard.

## Candidate commands

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 3000
npm run test
```

## Candidate brief

# Pulseboard Launch Sprint

## Overview

You are stepping into Pulseboard, a launch-readiness dashboard used by product, design, and engineering to coordinate a release window.

The repo is already scaffolded as a normal React + TypeScript + Vite app. Your job is to finish a real product feature, not to bootstrap a project from scratch.

## Core task

Build the missing "Add launch task" workflow into the dashboard.

Right now the UI has a task composer, but submitting it does not add anything into the checklist.

You should:

- make the composer create a real task in the launch list
- validate required fields before submission
- clear the form after a successful add
- make sure the new task is immediately searchable and filterable
- keep the current styling and layout intact

## Candidate workflow

- Explore the codebase and understand how state flows through the dashboard.
- Run the app locally in the sandbox.
- Run the tests to verify current behavior.
- Implement the missing feature and leave the tests passing.
- Submit the assessment from the top-right submit action when finished.

## Sandbox commands

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 3000
npm run test
```

## Product context

- The left rail summarizes launch momentum.
- The hero section tracks release confidence and launch score.
- The checklist is where teams drive the ship date forward.
- The composer is intentionally incomplete and is the main assessment task.
- The activity feed gives hiring teams something concrete to review on submission.

## Submission

- Keep the repo runnable.
- Keep the tests green.
- Use the in-product submit button when you are done.
