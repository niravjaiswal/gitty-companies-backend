-- 001_foundation.sql
-- Foundation schema for gitty-companies: profiles, sessions, session_events, snapshots

-- ════════════════════════════════════════════════════════════════════════
-- PROFILES
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  display_name  text,
  avatar_url    text,
  has_used_session boolean not null default false,
  session_ended_reason text,  -- 'completed' | 'connection_lost' | 'timed_out' | 'error'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Auto-create a profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Updated_at trigger for profiles
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════
-- SESSIONS
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  sandbox_id          text not null default '',
  status              text not null default 'starting'
                      check (status in ('starting','running','disconnected','stopped','error','timed_out','abandoned')),
  created_at          timestamptz not null default now(),
  last_activity_at    timestamptz not null default now(),
  disconnected_at     timestamptz,
  stopped_at          timestamptz,
  total_disconnections integer not null default 0
);

create index if not exists idx_sessions_user_id on public.sessions(user_id);
create index if not exists idx_sessions_status on public.sessions(status);

-- ════════════════════════════════════════════════════════════════════════
-- SESSION EVENTS (audit log)
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.session_events (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions(id) on delete cascade,
  event_type  text not null,  -- 'created' | 'running' | 'disconnected' | 'reconnected' | 'abandoned' | 'stopped' | 'timed_out' | 'error'
  metadata    jsonb default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists idx_session_events_session_id on public.session_events(session_id);

-- ════════════════════════════════════════════════════════════════════════
-- SNAPSHOTS (optional, for future file-state captures)
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.snapshots (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions(id) on delete cascade,
  label       text,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists idx_snapshots_session_id on public.snapshots(session_id);

-- ════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════════

alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.session_events enable row level security;
alter table public.snapshots enable row level security;

-- Profiles: users can read/update their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Sessions: users can view their own sessions
create policy "Users can view own sessions"
  on public.sessions for select
  using (auth.uid() = user_id);

-- Session events: users can view events for their own sessions
create policy "Users can view own session events"
  on public.session_events for select
  using (
    exists (
      select 1 from public.sessions s
      where s.id = session_events.session_id
        and s.user_id = auth.uid()
    )
  );

-- Snapshots: users can view their own snapshots
create policy "Users can view own snapshots"
  on public.snapshots for select
  using (
    exists (
      select 1 from public.sessions s
      where s.id = snapshots.session_id
        and s.user_id = auth.uid()
    )
  );
