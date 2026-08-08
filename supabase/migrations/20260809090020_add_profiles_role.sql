-- Minimal MVP authorization model: profiles.role distinguishes an ordinary
-- user from an admin. Defaults 'user' for every existing and future row.
alter table public.profiles
  add column role text not null default 'user' check (role in ('user', 'admin'));

comment on column public.profiles.role is
  'user | admin. Defaults to user for every signup. Not writable by the authenticated role (see the grant below) — only service_role can change it today, closing the self-promotion path a blanket UPDATE grant would otherwise allow.';

-- profiles_update_own's RLS USING/WITH CHECK only verifies row ownership
-- (auth.uid() = id), not which columns changed — before this migration a
-- client could already PATCH any column on their own row, including one
-- named "role" the moment it existed. Column-level GRANT is the correct
-- layer to close this (RLS policies cannot express "these columns only");
-- restrict the grant to exactly the columns
-- src/app/onboarding/preferences/page.tsx actually writes today.
revoke update on public.profiles from authenticated;
grant update (country_of_residence, university_id, custom_university, major_id, custom_major)
  on public.profiles to authenticated;

-- Read-your-own-role helper for RLS policies on other tables (jobs, audit
-- events, etc.). SECURITY INVOKER, not DEFINER: the calling user already
-- has SELECT on their own profiles row via profiles_select_own, so no
-- elevated privilege is needed — this only ever evaluates auth.uid()'s own
-- row, matching AGENTS.md's "avoid SECURITY DEFINER unless genuinely
-- necessary."
create or replace function public.is_admin()
returns boolean
language sql
security invoker
stable
set search_path = ''
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

comment on function public.is_admin() is
  'True only if the calling session''s own profiles.role = admin. SECURITY INVOKER: relies on profiles_select_own RLS, never bypasses it. Used by admin-gated RLS policies on jobs/audit_events and by the server-side requireAdmin() helper (src/lib/authz).';
