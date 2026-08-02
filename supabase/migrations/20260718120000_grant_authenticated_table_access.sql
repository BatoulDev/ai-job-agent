-- RLS policies alone do not grant Data API access: PostgREST checks the
-- standard Postgres GRANT layer before RLS ever runs. This CLI's config.toml
-- defaults auto_expose_new_tables to off (the current Supabase cloud default),
-- so the tables created in the earlier Phase 1 migrations were never reachable
-- by the "authenticated" role until now. Grants below match each table's
-- existing RLS policy surface exactly (see the corresponding create-table
-- migrations for the policies themselves).

-- profiles: only select/update policies exist (insert is trigger-only via
-- handle_new_user, which runs as SECURITY DEFINER and bypasses grants; no
-- delete policy, cascade-only via auth.users deletion).
grant select, update on public.profiles to authenticated;

-- job_preferences: full CRUD policies exist for the owning user.
grant select, insert, update, delete on public.job_preferences to authenticated;

-- cvs: full CRUD policies exist for the owning user.
grant select, insert, update, delete on public.cvs to authenticated;
