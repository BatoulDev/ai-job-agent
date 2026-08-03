-- job_preference_locations: many-to-many join between job_preferences and
-- locations, replacing the old single free-text location column for
-- anything the user picks from the reference list ("Other location"
-- entries live in job_preferences.custom_locations instead).
create table public.job_preference_locations (
  job_preference_id uuid not null references public.job_preferences (id) on delete cascade,
  location_id text not null references public.locations (slug),
  created_at timestamptz not null default now(),
  primary key (job_preference_id, location_id)
);

comment on table public.job_preference_locations is
  'Selected reference preferred locations for a job_preferences row (required when work_arrangement is onsite/hybrid — enforced in save_job_preferences).';

alter table public.job_preference_locations enable row level security;

create policy "job_preference_locations_select_own"
  on public.job_preference_locations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.job_preferences jp
      where jp.id = job_preference_id and jp.user_id = auth.uid()
    )
  );

create policy "job_preference_locations_insert_own"
  on public.job_preference_locations
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.job_preferences jp
      where jp.id = job_preference_id and jp.user_id = auth.uid()
    )
  );

create policy "job_preference_locations_delete_own"
  on public.job_preference_locations
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.job_preferences jp
      where jp.id = job_preference_id and jp.user_id = auth.uid()
    )
  );

grant select, insert, delete on public.job_preference_locations to authenticated;
grant select, insert, update, delete on public.job_preference_locations to service_role;

-- Reuses the shared child-version-bump function created alongside
-- job_preference_target_roles (20260806090070) — same rationale applies.
create trigger bump_job_preferences_version_for_locations
  after insert or delete on public.job_preference_locations
  for each row
  execute function public.bump_job_preferences_version_for_child();
