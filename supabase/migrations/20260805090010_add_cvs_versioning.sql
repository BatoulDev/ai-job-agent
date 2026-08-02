-- Adds the columns needed to eventually replace a CV without destroying
-- history: version, is_active, superseded_at. Schema foundation only —
-- the actual "Replace CV" server action is NOT implemented by this
-- migration or this phase. See the SCHEMA CONFLICT note below for why.
alter table public.cvs
  add column version integer not null default 1,
  add column is_active boolean not null default true,
  add column superseded_at timestamptz;

comment on column public.cvs.version is
  'Increments each time this user replaces their CV. Not yet written by any code path — the Replace CV action that would do so is deferred (see SCHEMA CONFLICT note on this migration).';
comment on column public.cvs.is_active is
  'Exactly one true row per user at a time (see cvs_one_active_per_user). Defaults true so every existing single-CV-per-user row is trivially valid.';
comment on column public.cvs.superseded_at is
  'Set when a newer CV version replaces this one. Null for the active row and for every row created before versioning existed.';

-- Forward-looking invariant: at most one active CV per user. Safe to add
-- now — under today's reality (still exactly one cvs row per user; see
-- the conflict note below) every existing row trivially satisfies it.
create unique index cvs_one_active_per_user
  on public.cvs (user_id)
  where is_active = true;

-- SCHEMA CONFLICT — reported, not resolved, in this phase:
--
-- cvs_user_id_key (a plain, non-partial unique(user_id) constraint from
-- 20260714153058_create_cvs.sql) still exists and is intentionally NOT
-- dropped here. It structurally guarantees at most one cvs row per user,
-- period — which is the exact opposite of "preserve CV history across
-- replacement." It cannot be dropped in this phase without an immediate
-- regression: src/app/onboarding/upload-cv/page.tsx performs
-- `.from("cvs").upsert({...}, { onConflict: "user_id" })`, and Postgres'
-- ON CONFLICT target must name a real unique constraint/index on exactly
-- those columns. Supabase-js's .upsert() cannot target a WHERE-qualified
-- (partial) unique index such as cvs_one_active_per_user — only raw SQL
-- can express `ON CONFLICT (user_id) WHERE is_active`. Dropping
-- cvs_user_id_key today would break every CV upload with a Postgres
-- error before any replacement code existed to take its place.
--
-- Resolving this is exactly the deferred "Replace CV server action":
-- when it's built, it must (in one transaction, using the service-role
-- client, not a client-side upsert):
--   1. insert a new cvs row for the same user (new id, version =
--      previous active version + 1, is_active = true)
--   2. update the previous active row: is_active = false,
--      superseded_at = now()
--   3. only then drop cvs_user_id_key (a separate, reviewed migration,
--      since two rows for one user will exist for the first time)
--   4. create a new analysis_tasks row with task_type = 'full_analysis'
--      for the new CV version (see 20260805090020_extend_analysis_tasks_lifecycle.sql)
-- Never delete the old row or its Storage object — previous cv_analyses,
-- and future matches/cover letters/applications, may still reference it
-- by cv_id.
