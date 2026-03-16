-- ============================================================================
-- Activity Monitoring Tables
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================================

-- SESSION_ACTIVITY: individual events (commands, file changes)
-- This is append-only and can get large. Indexed for time-range queries.
create table if not exists public.session_activity (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,

  event_type text not null check (event_type in (
    'command_run',
    'file_create', 'file_modify', 'file_delete', 'file_move',
    'session_start', 'session_end'
  )),

  -- For command_run: the command string
  -- For file events: relative file path
  detail text,

  -- Additional structured data (command output, old path for moves, etc.)
  metadata jsonb default '{}'::jsonb,

  occurred_at timestamptz not null,
  collected_at timestamptz not null default now()
);

create index idx_session_activity_session_time
  on public.session_activity(session_id, occurred_at);
create index idx_session_activity_session_type
  on public.session_activity(session_id, event_type);

-- CODE_SNAPSHOTS: periodic full snapshots of the user's code
create table if not exists public.code_snapshots (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,

  -- All files as { "relative/path.ts": "file contents...", ... }
  files jsonb not null,

  -- Summary stats
  file_count int not null default 0,
  total_bytes bigint not null default 0,

  snapshot_at timestamptz not null,
  collected_at timestamptz not null default now()
);

create index idx_code_snapshots_session_time
  on public.code_snapshots(session_id, snapshot_at);

-- FINAL_SUBMISSION: the final state of the code when session ends
create table if not exists public.final_submissions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- All files at time of submission
  files jsonb not null,

  file_count int not null default 0,
  total_bytes bigint not null default 0,

  -- Summary stats about the session
  total_commands_run int not null default 0,
  total_file_changes int not null default 0,
  session_duration_seconds int not null default 0,
  total_disconnections int not null default 0,

  submitted_at timestamptz not null default now()
);

create index idx_final_submissions_user
  on public.final_submissions(user_id);

-- RLS
alter table public.session_activity enable row level security;
alter table public.code_snapshots enable row level security;
alter table public.final_submissions enable row level security;

create policy "Users can view own session activity" on public.session_activity
  for select using (session_id in (select id from public.sessions where user_id = auth.uid()));
create policy "Users can view own code snapshots" on public.code_snapshots
  for select using (session_id in (select id from public.sessions where user_id = auth.uid()));
create policy "Users can view own submissions" on public.final_submissions
  for select using (auth.uid() = user_id);
