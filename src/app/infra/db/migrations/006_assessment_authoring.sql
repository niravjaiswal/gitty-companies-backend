alter table public.assessments
  add column if not exists source_brief text not null default '';

alter table public.assessments
  add column if not exists authoring_config jsonb not null default '{"mode":"single","stages":[]}'::jsonb;
