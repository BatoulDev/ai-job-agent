-- cv_analyses: one row per CV-analysis attempt/result. Foundation only —
-- no worker, AI provider call, or review API is built by this migration
-- (Phase 4A is schema + security only; the extraction/AI pipeline and the
-- review endpoint are later, separate work — see the Phase 4A addendum in
-- DATABASE_PLAN.md for the exact automation contract this table expects).
--
-- Three logically separate regions live in this one table, and must stay
-- that way for every future caller:
--   1. cv_facts        — professional_summary..extracted_text below.
--                        Supported ONLY by the CV itself. Preferences must
--                        never alter these values.
--   2. preference_snapshot — the job_preferences row as it existed at
--                        analysis time, copied verbatim. NOT the source of
--                        truth for current preferences — job_preferences
--                        still is. This is a historical record only, so a
--                        later preferences edit can never retroactively
--                        change what an existing analysis says it used.
--   3. ai_career_profile — profile_level..development_areas below.
--                        Conclusions the model drew from (1) informed by
--                        (2). May reference facts but must never invent or
--                        overwrite them.
--
-- Ownership boundary: user_id references auth.users.id directly, matching
-- every other table in this schema (cvs, job_preferences, subscriptions,
-- analysis_tasks) — never profiles.id, never anything client-editable.
create table public.cv_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cv_id uuid not null references public.cvs (id) on delete cascade,
  -- A task can produce at most one analysis row (unique below) — set null
  -- rather than cascade, so a result already saved for the user is never
  -- silently destroyed just because its originating task row was pruned.
  analysis_task_id uuid references public.analysis_tasks (id) on delete set null,

  -- Processing information
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  error_message text,
  ai_provider text,
  ai_model text,
  analysis_version text not null default 'v1',
  analyzed_at timestamptz,

  -- cv_facts — extracted only from the CV, never influenced by preferences.
  professional_summary text,
  skills jsonb not null default '[]'::jsonb check (jsonb_typeof(skills) = 'array'),
  education jsonb not null default '[]'::jsonb check (jsonb_typeof(education) = 'array'),
  work_experience jsonb not null default '[]'::jsonb check (jsonb_typeof(work_experience) = 'array'),
  projects jsonb not null default '[]'::jsonb check (jsonb_typeof(projects) = 'array'),
  certifications jsonb not null default '[]'::jsonb check (jsonb_typeof(certifications) = 'array'),
  languages jsonb not null default '[]'::jsonb check (jsonb_typeof(languages) = 'array'),
  contact_info jsonb check (contact_info is null or jsonb_typeof(contact_info) = 'object'),
  extracted_text text,

  -- preference_snapshot — historical copy only, see header comment.
  preference_snapshot jsonb not null check (jsonb_typeof(preference_snapshot) = 'object'),

  -- ai_career_profile — conclusions drawn from cv_facts + preference_snapshot.
  -- profile_level reuses job_preferences.experience_level's exact vocabulary
  -- (see 20260804090000_extend_job_preferences_experience_level.sql) so the
  -- user's self-reported level and the AI-assessed level are always
  -- directly comparable, never two different taxonomies.
  profile_level text check (profile_level is null or profile_level in (
    'internship', 'entry-level', 'junior', 'mid-level', 'senior', 'open-to-all'
  )),
  recommended_roles jsonb not null default '[]'::jsonb check (jsonb_typeof(recommended_roles) = 'array'),
  strongest_areas jsonb not null default '[]'::jsonb check (jsonb_typeof(strongest_areas) = 'array'),
  career_recommendations jsonb not null default '[]'::jsonb check (jsonb_typeof(career_recommendations) = 'array'),
  search_focus jsonb not null default '[]'::jsonb check (jsonb_typeof(search_focus) = 'array'),
  development_areas jsonb not null default '[]'::jsonb check (jsonb_typeof(development_areas) = 'array'),

  -- User review workflow. No column here is writable by the authenticated
  -- role yet — see the RLS section below and the Phase 4A addendum for
  -- what a future review API must (and must not) do.
  review_status text not null default 'pending_review' check (review_status in ('pending_review', 'approved', 'changes_requested')),
  user_edits jsonb check (user_edits is null or jsonb_typeof(user_edits) = 'object'),
  reviewed_at timestamptz,
  approved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One task produces at most one analysis result (idempotency at the DB
  -- layer, matching analysis_tasks' own idempotency_key pattern).
  constraint cv_analyses_analysis_task_id_key unique (analysis_task_id)
);

comment on table public.cv_analyses is
  'One row per CV-analysis attempt. cv_facts columns are extracted from the CV only; preference_snapshot is a historical copy, never the live source of truth (job_preferences is); ai_career_profile columns are model conclusions. Foundation only — no worker or review API exists yet.';

-- At most one APPROVED analysis per user at any time — this is "the"
-- profile future job matching must read. A later approve action must
-- supersede (not just add to) any prior approved row for the same user;
-- the database enforces that invariant rather than trusting application
-- code alone.
create unique index cv_analyses_one_approved_per_user
  on public.cv_analyses (user_id)
  where review_status = 'approved';

create index cv_analyses_user_id_idx on public.cv_analyses (user_id);
create index cv_analyses_cv_id_idx on public.cv_analyses (cv_id);
create index cv_analyses_status_idx on public.cv_analyses (status);
create index cv_analyses_review_status_idx on public.cv_analyses (review_status);

alter table public.cv_analyses enable row level security;

create trigger set_cv_analyses_updated_at
  before update on public.cv_analyses
  for each row
  execute function public.set_updated_at();

-- Users may read only their own analyses. No insert/update/delete policy
-- exists for the authenticated role at all: a browser client can never
-- create an analysis result, change its processing metadata or AI model
-- info, retarget it to another user, or set its own review_status.
-- Trusted backend/automation code (src/lib/supabase/admin.ts, service_role
-- only, never imported by anything shipped to the browser) creates and
-- updates these rows directly — the same pattern already used for
-- subscriptions/payment_attempts/analysis_tasks. A future validated review
-- endpoint (not built in this phase) is the only path that may ever let a
-- user influence review_status/user_edits/reviewed_at/approved_at, and it
-- must run server-side and re-derive auth.uid() itself rather than trust
-- a client-supplied user id — see the Phase 4A addendum for exactly what
-- that endpoint must enforce.
create policy "cv_analyses_select_own"
  on public.cv_analyses
  for select
  to authenticated
  using (auth.uid() = user_id);

grant select on public.cv_analyses to authenticated;
grant select, insert, update, delete on public.cv_analyses to service_role;
