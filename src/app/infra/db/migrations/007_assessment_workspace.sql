alter table public.assessments
  add column if not exists workspace_files jsonb not null default '{}'::jsonb;

alter table public.assessments
  add column if not exists workspace_entry_file text not null default '';

alter table public.assessments
  add column if not exists workspace_generated_at timestamptz;
