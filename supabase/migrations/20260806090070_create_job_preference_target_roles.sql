-- job_preference_target_roles: many-to-many join between job_preferences
-- and target_roles, replacing the old single free-text target_roles
-- column for anything the user picks from the reference list ("Other
-- role" entries live in job_preferences.custom_target_roles instead).
create table public.job_preference_target_roles (
  job_preference_id uuid not null references public.job_preferences (id) on delete cascade,
  target_role_id text not null references public.target_roles (slug),
  created_at timestamptz not null default now(),
  primary key (job_preference_id, target_role_id)
);

comment on table public.job_preference_target_roles is
  'Selected reference target roles for a job_preferences row (1-5 total combined with custom_target_roles — enforced in save_job_preferences).';

alter table public.job_preference_target_roles enable row level security;

-- Ownership flows through job_preferences, exactly like every other
-- owned-child pattern in this schema — a user may only touch rows whose
-- parent job_preferences row belongs to them.
create policy "job_preference_target_roles_select_own"
  on public.job_preference_target_roles
  for select
  to authenticated
  using (
    exists (
      select 1 from public.job_preferences jp
      where jp.id = job_preference_id and jp.user_id = auth.uid()
    )
  );

create policy "job_preference_target_roles_insert_own"
  on public.job_preference_target_roles
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.job_preferences jp
      where jp.id = job_preference_id and jp.user_id = auth.uid()
    )
  );

create policy "job_preference_target_roles_delete_own"
  on public.job_preference_target_roles
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.job_preferences jp
      where jp.id = job_preference_id and jp.user_id = auth.uid()
    )
  );

grant select, insert, delete on public.job_preference_target_roles to authenticated;
grant select, insert, update, delete on public.job_preference_target_roles to service_role;

-- Role selections now live outside the job_preferences row itself, so its
-- own bump_job_preferences_version trigger (which only fires on job_preferences
-- column changes) can't see them. This mirrors that trigger's intent —
-- touching the parent row's version whenever this child table changes —
-- so cv_analyses staleness detection keeps working once roles move here.
create or replace function public.bump_job_preferences_version_for_child()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job_preference_id uuid := coalesce(new.job_preference_id, old.job_preference_id);
begin
  update public.job_preferences
  set version = version + 1, updated_at = now()
  where id = v_job_preference_id;

  return coalesce(new, old);
end;
$$;

create trigger bump_job_preferences_version_for_target_roles
  after insert or delete on public.job_preference_target_roles
  for each row
  execute function public.bump_job_preferences_version_for_child();
