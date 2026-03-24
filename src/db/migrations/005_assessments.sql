-- ============================================================================
-- Company-managed assessments and email-based candidate assignments
-- ============================================================================

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  summary text not null default '',
  instructions_md text not null default '',
  duration_minutes integer not null check (duration_minutes > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assessment_assignments (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  candidate_email text not null,
  candidate_email_normalized text not null,
  candidate_user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'assigned'
    check (status in ('assigned', 'claimed', 'started', 'completed', 'expired')),
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, candidate_email_normalized)
);

create index if not exists idx_company_members_user_id on public.company_members(user_id);
create index if not exists idx_assessments_company_id on public.assessments(company_id);
create index if not exists idx_assessment_assignments_assessment_id on public.assessment_assignments(assessment_id);
create index if not exists idx_assessment_assignments_candidate_email on public.assessment_assignments(candidate_email_normalized);
create index if not exists idx_assessment_assignments_candidate_user_id on public.assessment_assignments(candidate_user_id);

alter table public.sessions
  add column if not exists assessment_id uuid references public.assessments(id) on delete set null;

alter table public.sessions
  add column if not exists assignment_id uuid unique references public.assessment_assignments(id) on delete set null;

drop trigger if exists companies_updated_at on public.companies;
create trigger companies_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

drop trigger if exists company_members_updated_at on public.company_members;
create trigger company_members_updated_at
  before update on public.company_members
  for each row execute function public.set_updated_at();

drop trigger if exists assessments_updated_at on public.assessments;
create trigger assessments_updated_at
  before update on public.assessments
  for each row execute function public.set_updated_at();

drop trigger if exists assessment_assignments_updated_at on public.assessment_assignments;
create trigger assessment_assignments_updated_at
  before update on public.assessment_assignments
  for each row execute function public.set_updated_at();

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_assignments enable row level security;

drop policy if exists "Company members can view their companies" on public.companies;
create policy "Company members can view their companies"
  on public.companies for select
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = companies.id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists "Company members can view membership" on public.company_members;
create policy "Company members can view membership"
  on public.company_members for select
  using (user_id = auth.uid());

drop policy if exists "Company members can view company assessments" on public.assessments;
create policy "Company members can view company assessments"
  on public.assessments for select
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = assessments.company_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists "Candidates can view their claimed assignments" on public.assessment_assignments;
create policy "Candidates can view their claimed assignments"
  on public.assessment_assignments for select
  using (
    candidate_user_id = auth.uid()
    or candidate_email_normalized = lower(coalesce(auth.jwt()->>'email', ''))
    or exists (
      select 1 from public.company_members cm
      where cm.company_id = assessment_assignments.company_id
        and cm.user_id = auth.uid()
    )
  );
