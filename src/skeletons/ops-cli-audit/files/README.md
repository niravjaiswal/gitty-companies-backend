# Ops CLI Audit

A TypeScript CLI for reviewing an operational snapshot before a release.

## Getting started

```bash
npm install
npm run dev -- --input ./path/to/snapshot.json
npm test
```

## Overview

The CLI reads a JSON snapshot, converts failing checks into findings, and prints either a text summary or a JSON report.

The built-in sample snapshot is useful for local experimentation:

```bash
npm run dev
npm run dev -- --format json
```

## Your task

The audit engine already works, but suppression rules are too strict.

`src/filter.ts` only supports exact `service:code` matches. Update it so the CLI can ignore noisy checks with glob-style patterns such as:

- `billing:*`
- `*:ownership`
- `search:latency-*`

Keep the report format stable and make sure the CLI still passes the test suite.
