-- service_role already bypasses RLS on every table in this project
-- (rolbypassrls = true — see every migration's "service-role client
-- bypasses Row Level Security entirely" comments), but bypassing RLS is
-- a separate layer from the standard Postgres GRANT layer PostgREST
-- checks first (the same reason 20260718120000_grant_authenticated_table_access.sql
-- was needed for the authenticated role, per this project's
-- auto_expose_new_tables=off config). Without this migration, service_role
-- had no select/insert/update/delete grants on any table at all — only
-- incidental REFERENCES/TRIGGER/TRUNCATE — so src/lib/supabase/admin.ts
-- could only ever succeed by calling a SECURITY DEFINER RPC, never a
-- direct table read/write, even though its whole documented purpose is
-- unrestricted trusted server-side access. This grants exactly what a
-- hosted Supabase project's service_role already has by default.
--
-- This does not change what the browser (anon/authenticated) can do —
-- those grants are untouched. service_role is never used by, or exposed
-- to, any client code.
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.job_preferences to service_role;
grant select, insert, update, delete on public.cvs to service_role;
grant select, insert, update, delete on public.plans to service_role;
grant select, insert, update, delete on public.subscriptions to service_role;
grant select, insert, update, delete on public.payment_attempts to service_role;
grant select, insert, update, delete on public.analysis_tasks to service_role;
