# Northstar Orders Board

## Overview

You are stepping into Northstar Commerce, where dispatch and operations teams track same-day fulfillment on a live React board.

The repo is already scaffolded as a normal React + TypeScript + Vite app. Your job is to keep the board state consistent as orders are searched, filtered, selected, and updated.

## Core task

Stabilize the reducer-driven order board so the interface behaves like a real operations tool.

You should:
- keep urgent orders pinned ahead of standard orders
- preserve the selected order while the board updates
- advance an order through the fulfillment pipeline
- create a new order from the composer and clear the draft fields
- keep counts, search, and filters aligned with the underlying state

## Candidate workflow

- Explore the codebase and understand how state flows through the board.
- Run the app locally in the sandbox.
- Run the tests to verify current behavior.
- Implement the missing state logic and leave the tests passing.
- Submit the assessment when you are done.

## Sandbox commands

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 3000
npm run test
```

## Product context

- The left rail summarizes queue health and order pressure.
- The board shows active orders grouped by status.
- The details panel lets dispatchers advance a selected order.
- The composer is intentionally central to the assessment and touches the reducer.
- The interface should feel like a real internal tool, not a toy demo.

## Submission

- Keep the repo runnable.
- Keep the tests green.
- Preserve the board layout while fixing the state transitions.
