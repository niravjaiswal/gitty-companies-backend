-- 009_generation_metrics.sql
-- Adds a jsonb column for per-job generation telemetry (turns, cost, duration,
-- verified pass/fail) across primary and repair agent passes. Populated by
-- GenerationQueue.processJob on both success and failure paths.

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS generation_metrics jsonb;
