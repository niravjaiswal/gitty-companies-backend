-- 008_generation_queue.sql
-- Adds async generation tracking columns to assessments table.
-- Supports the in-process polling queue that runs the remix pipeline.

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS skeleton_id text;

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS generation_status text
  CHECK (generation_status IS NULL OR generation_status IN ('pending', 'processing', 'completed', 'failed'));

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS generation_error text;

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS generation_started_at timestamptz;

ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS generation_completed_at timestamptz;

-- Partial index for fast polling: only index rows with pending status
CREATE INDEX IF NOT EXISTS idx_assessments_generation_pending
  ON public.assessments (created_at ASC)
  WHERE generation_status = 'pending';
