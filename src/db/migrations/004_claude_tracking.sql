-- ============================================================================
-- Claude Code Tracking
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================================

-- 1. Extend session_activity event_type CHECK to include Claude events
ALTER TABLE public.session_activity
  DROP CONSTRAINT IF EXISTS session_activity_event_type_check;

ALTER TABLE public.session_activity
  ADD CONSTRAINT session_activity_event_type_check CHECK (event_type IN (
    'command_run',
    'file_create', 'file_modify', 'file_delete', 'file_move',
    'session_start', 'session_end',
    'claude_prompt', 'claude_tool_use', 'claude_response'
  ));

-- 2. Claude transcripts table: complete session transcripts from Claude Code
CREATE TABLE IF NOT EXISTS public.claude_transcripts (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  claude_session_id text not null,
  transcript_jsonl text not null,

  -- Summary stats parsed from transcript
  total_prompts int not null default 0,
  total_tool_calls int not null default 0,
  total_tokens_in int not null default 0,
  total_tokens_out int not null default 0,

  collected_at timestamptz not null default now()
);

CREATE INDEX idx_claude_transcripts_session
  ON public.claude_transcripts(session_id);

-- 3. Add Claude stats columns to final_submissions
ALTER TABLE public.final_submissions
  ADD COLUMN IF NOT EXISTS total_claude_prompts int not null default 0;
ALTER TABLE public.final_submissions
  ADD COLUMN IF NOT EXISTS total_claude_tool_calls int not null default 0;

-- 4. RLS for claude_transcripts
ALTER TABLE public.claude_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own claude transcripts" ON public.claude_transcripts
  FOR SELECT USING (session_id IN (SELECT id FROM public.sessions WHERE user_id = auth.uid()));
