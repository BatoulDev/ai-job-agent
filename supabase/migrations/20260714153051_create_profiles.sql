-- profiles: one row per Supabase Auth user.
--
-- Ownership boundary: the primary key IS auth.users.id. Editable fields
-- (full_name, university, major) are never used as identifiers or foreign
-- keys anywhere else. Email is intentionally NOT duplicated here — it
-- remains owned by auth.users. No plan/billing/subscription/usage data
-- belongs on this table; that is a deliberate boundary for future phases.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  university text,
  major text,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth.users id. Ownership is the immutable auth user id, never email or full_name.';

alter table public.profiles enable row level security;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- A user may read and update only their own profile row.
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No insert policy for the authenticated role on purpose: rows are created
-- only by the handle_new_user trigger (see the handle_new_user_trigger
-- migration), which runs as a security definer function and bypasses RLS.
-- This closes off any path for a user to insert a profile row under
-- someone else's id.
--
-- No delete policy: rows are removed automatically via
-- "on delete cascade" when the underlying auth.users row is deleted.
