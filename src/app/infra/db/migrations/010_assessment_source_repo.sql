-- 010_assessment_source_repo.sql
-- Adds "bring your own repo" (BYOR) source metadata to assessments.
-- source_type distinguishes skeleton+AI-remix (default / legacy NULL)
-- from repo-ingested (as-is) workspaces.

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS source_type text
  CHECK (source_type IS NULL OR source_type IN ('skeleton', 'repo'));

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS source_repo_url text;

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS source_repo_ref text;

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS source_repo_commit_sha text;

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS source_repo_metadata jsonb;
