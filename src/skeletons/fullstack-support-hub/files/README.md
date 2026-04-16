# Northstar Support Hub

## Overview

You are working in Northstar's internal support console. The repo already includes an Express API, a React dashboard, and an in-memory ticket store.

The escalation policy is intentionally conservative. Your job is to refine the risk scoring so tickets that are aging, quiet, or otherwise high-friction appear in the escalation queue more reliably, while keeping the API and UI synchronized.

## Core task

Improve the escalation logic in `src/shared/risk.ts`, then adjust the server or frontend if needed so the queue counts, summary cards, and ticket details stay aligned after note updates.

You should:

- improve how high-risk tickets are identified
- keep the ticket list, summary strip, and detail panel synchronized after note updates
- preserve the current filtering, searching, and note-taking behavior
- keep the API and frontend tests passing

## Candidate workflow

1. Read the support data model and shared scoring helper
2. Run the tests to see how the dashboard behaves today
3. Update the escalation policy and any dependent UI or API code
4. Make sure the project still typechecks and the tests stay green

## Commands

```bash
npm install
npm run server
npm run dev -- --host 0.0.0.0 --port 3000
npm test
```
