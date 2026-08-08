-- Resolves the SCHEMA CONFLICT documented in 20260805090010_add_cvs_versioning.sql:
-- cvs_user_id_key (plain unique) is dropped and replaced end-to-end by the
-- already-existing partial unique index cvs_one_active_per_user, via the
-- exact 4-step transaction that migration's own comment specifies:
--   1. insert a new cvs row (new id, version = previous active + 1, is_active = true)
--   2. deactivate the previous active row (is_active = false, superseded_at = now())
--   3. drop cvs_user_id_key (below, now safe — no code path upserts on it anymore)
--   4. enqueue a new analysis_tasks row for the new CV version, but ONLY when an
--      existing active CV is actually being replaced — first-time onboarding
--      uploads keep their existing, unchanged timing via
--      /api/onboarding/complete (which already enqueues 'onboarding_completed'
--      once the whole onboarding flow, not just the CV step, is done).
--
-- Runs as SECURITY DEFINER, granted directly to authenticated (mirroring
-- save_job_preferences/create_payment_attempt, not create_analysis_task):
-- cvs already grants authenticated full RLS-scoped CRUD, so this needs no
-- privilege authenticated doesn't already have for cvs itself — it needs
-- elevated privilege only for the internal analysis_tasks insert (which has
-- no authenticated write policy at all). auth.uid() is always derived
-- internally, never accepted as a parameter.
create or replace function public.replace_cv(
  p_storage_path text,
  p_file_name text,
  p_file_size_bytes integer,
  p_mime_type text
)
returns public.cvs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_old public.cvs;
  v_new public.cvs;
  v_had_active boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_storage_path is null or p_storage_path not like (v_user_id::text || '/%') then
    raise exception 'storage_path must be scoped to the authenticated user''s own folder.';
  end if;

  -- Lock any existing active row first so a concurrent replace/first-upload
  -- for the same user serializes here rather than racing the insert below.
  -- v_had_active is captured explicitly rather than relying on FOUND, which
  -- would otherwise be overwritten (always true) by the INSERT below.
  select * into v_old
  from public.cvs
  where user_id = v_user_id and is_active = true
  for update;

  v_had_active := found;

  if v_had_active then
    update public.cvs
    set is_active = false, superseded_at = now()
    where id = v_old.id;
  end if;

  insert into public.cvs (
    user_id, storage_path, file_name, file_size_bytes, mime_type, status, version, is_active
  )
  values (
    v_user_id, p_storage_path, p_file_name, p_file_size_bytes, p_mime_type,
    'uploaded', coalesce(v_old.version, 0) + 1, true
  )
  returning * into v_new;

  -- Only a true replacement (an existing active CV superseded) enqueues a
  -- task here. First-time uploads keep relying on /api/onboarding/complete,
  -- unchanged, to enqueue 'onboarding_completed' once preferences are done
  -- too — not at CV-upload time.
  if v_had_active then
    perform public.create_analysis_task(v_user_id, v_new.id, 'cv_replaced');
  end if;

  return v_new;
end;
$$;

revoke execute on function public.replace_cv(text, text, integer, text) from public;
grant execute on function public.replace_cv(text, text, integer, text) to authenticated;

-- With replace_cv() now the sanctioned write path (and no code path left
-- using .upsert({...}, {onConflict:"user_id"})), the plain unique
-- constraint that upsert depended on can finally be dropped — the partial
-- cvs_one_active_per_user index alone now enforces "at most one active CV
-- per user," which correctly allows historical (is_active = false) rows to
-- coexist.
alter table public.cvs drop constraint cvs_user_id_key;

-- Direct client insert/update is no longer the sanctioned path either
-- (replace_cv() is, and it runs as SECURITY DEFINER so it doesn't need
-- these policies). Removing them closes the flagged-but-previously-open
-- gap where cvs_update_own (row-scoped, not column-scoped) let a user
-- directly set their own is_active/version/superseded_at via a raw client
-- request (see DATABASE_PLAN.md, Phase 4B addendum, "Observed, not fixed").
drop policy "cvs_insert_own" on public.cvs;
drop policy "cvs_update_own" on public.cvs;
revoke insert, update on public.cvs from authenticated;
