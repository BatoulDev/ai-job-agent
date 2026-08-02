-- job_preferences: one row per user (MVP — matches the single "edit
-- preferences" screen, not multiple saved searches).
--
-- Ownership boundary: user_id references auth.users.id and is never set
-- from anything client-supplied other than the authenticated session.
create table public.job_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  target_roles text,
  location text,
  remote_preference text check (remote_preference in ('onsite', 'hybrid', 'remote', 'open')),
  job_type text check (job_type in ('internship', 'part-time', 'full-time', 'freelance', 'open')),
  experience_level text check (experience_level in ('internship', 'entry-level', 'junior')),
  additional_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.job_preferences is
  'One row per auth.users id (MVP). Ownership is user_id -> auth.users.id, never email or profile name.';

alter table public.job_preferences enable row level security;

create trigger set_job_preferences_updated_at
  before update on public.job_preferences
  for each row
  execute function public.set_updated_at();

create policy "job_preferences_select_own"
  on public.job_preferences
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "job_preferences_insert_own"
  on public.job_preferences
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "job_preferences_update_own"
  on public.job_preferences
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "job_preferences_delete_own"
  on public.job_preferences
  for delete
  to authenticated
  using (auth.uid() = user_id);
