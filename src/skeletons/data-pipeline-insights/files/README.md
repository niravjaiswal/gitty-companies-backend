# Pipeline Insights Console

A TypeScript data-processing assessment focused on batch aggregation, object-mode stream processing, and CLI reporting over telemetry events.

## Getting started

```bash
npm install
npm run dev
npm run test
```

## Overview

This workspace models a small telemetry analysis tool for a data platform. The codebase includes:

- a shared event model
- a batch summarizer for pipeline runs
- a stream transform that groups live telemetry into fixed windows
- a CLI that prints a deterministic insights report for bundled sample data

## Candidate task

The reporting layer in `src/report.ts` is the main assessment surface. Candidates should understand how the batch and stream layers interact, then extend the report without breaking the existing tests or data model.

## What to look for

- stable aggregation over a fixed event set
- object-mode stream processing instead of string parsing
- clear handling of late-arriving telemetry
- readable output suitable for a terminal
