-- 012_grading_correctness.sql
-- Adds correctness as a first-class grading dimension and decouples
-- the grade job state from the report-of-record row.
--
-- See .claude/docs/design-correctness-grading-pipeline.md for context.

-- ---------------------------------------------------------------------------
-- candidate_grades: correctness columns + grading_path provenance
-- ---------------------------------------------------------------------------
ALTER TABLE public.candidate_grades
  ADD COLUMN IF NOT EXISTS correctness_score   SMALLINT
    CHECK (correctness_score IS NULL OR (correctness_score BETWEEN 0 AND 100));

ALTER TABLE public.candidate_grades
  ADD COLUMN IF NOT EXISTS build_status        TEXT
    CHECK (build_status IS NULL OR build_status IN ('pass','fail','error','skipped'));

ALTER TABLE public.candidate_grades
  ADD COLUMN IF NOT EXISTS tests_passed        INTEGER;

ALTER TABLE public.candidate_grades
  ADD COLUMN IF NOT EXISTS tests_total         INTEGER;

ALTER TABLE public.candidate_grades
  ADD COLUMN IF NOT EXISTS grading_path        TEXT NOT NULL DEFAULT 'full'
    CHECK (grading_path IN (
      'full',
      'short_circuit_build_fail',
      'short_circuit_tests_zero',
      'runner_error_llm_only',
      'legacy_no_correctness'
    ));

ALTER TABLE public.candidate_grades
  ADD COLUMN IF NOT EXISTS runner_version      TEXT;

ALTER TABLE public.candidate_grades
  ADD COLUMN IF NOT EXISTS weights_version     TEXT NOT NULL DEFAULT 'v2';

ALTER TABLE public.candidate_grades
  ADD COLUMN IF NOT EXISTS runner_run_id       UUID;

-- Flag pre-existing rows so dashboards can distinguish legacy grades.
UPDATE public.candidate_grades
   SET grading_path    = 'legacy_no_correctness',
       weights_version = 'v1'
 WHERE correctness_score IS NULL
   AND grading_path    = 'full';

CREATE INDEX IF NOT EXISTS candidate_grades_grading_path_idx
  ON public.candidate_grades (grading_path);

-- ---------------------------------------------------------------------------
-- grading_runner_runs: append-only audit log of deterministic runner results.
-- One submission_hash can be reused across grade attempts to avoid re-running
-- the sandbox when the candidate's files haven't changed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grading_runner_runs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  submission_hash   TEXT        NOT NULL,
  runner_version    TEXT        NOT NULL,
  build_status      TEXT        NOT NULL CHECK (build_status IN ('pass','fail','error','skipped')),
  tests_passed      INTEGER,
  tests_total       INTEGER,
  duration_ms       INTEGER     NOT NULL,
  exit_codes        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  logs_head         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS grading_runner_runs_session_id_idx
  ON public.grading_runner_runs (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS grading_runner_runs_submission_hash_idx
  ON public.grading_runner_runs (submission_hash);

ALTER TABLE public.grading_runner_runs ENABLE ROW LEVEL SECURITY;

-- FK on candidate_grades.runner_run_id (deferred so the column exists first).
-- Wrapped in DO block because Postgres lacks ADD CONSTRAINT IF NOT EXISTS,
-- making the raw ALTER fail on any retry / partial re-apply.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'candidate_grades_runner_run_id_fkey'
       AND conrelid = 'public.candidate_grades'::regclass
  ) THEN
    ALTER TABLE public.candidate_grades
      ADD CONSTRAINT candidate_grades_runner_run_id_fkey
      FOREIGN KEY (runner_run_id)
      REFERENCES public.grading_runner_runs(id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- grading_jobs: queue state, decoupled from candidate_grades.
-- One active job per session at a time (UNIQUE on session_id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grading_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID        NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','running','completed','failed')),
  stage           TEXT
                              CHECK (stage IS NULL OR stage IN ('runner','llm','finalize')),
  attempts        INTEGER     NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS grading_jobs_pending_idx
  ON public.grading_jobs (created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS grading_jobs_running_idx
  ON public.grading_jobs (started_at ASC)
  WHERE status = 'running';

ALTER TABLE public.grading_jobs ENABLE ROW LEVEL SECURITY;

-- updated_at trigger (uses the existing set_updated_at function created in 001)
DROP TRIGGER IF EXISTS grading_jobs_updated_at ON public.grading_jobs;
CREATE TRIGGER grading_jobs_updated_at
  BEFORE UPDATE ON public.grading_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
