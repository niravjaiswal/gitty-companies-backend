-- Stores AI-generated evaluation grades for candidate assessment submissions.
-- One row per session (UNIQUE constraint on session_id).
CREATE TABLE IF NOT EXISTS candidate_grades (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  assignment_id             UUID        REFERENCES assessment_assignments(id) ON DELETE SET NULL,

  -- Dimension scores 0–100
  code_quality_score        SMALLINT    NOT NULL CHECK (code_quality_score        BETWEEN 0 AND 100),
  agent_usage_score         SMALLINT    NOT NULL CHECK (agent_usage_score         BETWEEN 0 AND 100),
  prompting_quality_score   SMALLINT    NOT NULL CHECK (prompting_quality_score   BETWEEN 0 AND 100),
  industry_knowledge_score  SMALLINT    NOT NULL CHECK (industry_knowledge_score  BETWEEN 0 AND 100),
  composite_score           SMALLINT    NOT NULL CHECK (composite_score           BETWEEN 0 AND 100),

  -- Hiring signal
  recommendation            TEXT        NOT NULL CHECK (recommendation IN ('strong_yes','yes','maybe','no','strong_no')),

  -- Per-dimension qualitative feedback stored as JSONB
  -- Shape: { codeQuality, agentUsage, promptingQuality, industryKnowledge }
  -- Each dimension: { score, summary, flags[] }
  feedback                  JSONB       NOT NULL DEFAULT '{}',

  graded_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  model_id                  TEXT        NOT NULL DEFAULT 'claude-sonnet-4-20250514',

  UNIQUE (session_id)
);

ALTER TABLE candidate_grades ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS candidate_grades_session_id_idx       ON candidate_grades (session_id);
CREATE INDEX IF NOT EXISTS candidate_grades_assignment_id_idx    ON candidate_grades (assignment_id);
CREATE INDEX IF NOT EXISTS candidate_grades_composite_score_idx  ON candidate_grades (composite_score DESC);
