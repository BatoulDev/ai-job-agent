-- Closes the other half of the readiness bug fixed in 20260812100000:
-- create_analysis_task() correctly refuses a second active task for the
-- SAME cv_id (analysis_tasks_one_active_per_cv), but nothing ever stopped
-- unfinished tasks from PRIOR cv_ids piling up for the same user — every
-- replace_cv() call enqueues a brand-new task for the new cv_id without
-- ever touching the task left behind for the CV it just deactivated. A
-- user who replaces their CV N times accumulates N simultaneously
-- claimable 'pending' tasks, one per historical CV version, forever (only
-- claim_analysis_task's existing `superseded_at is null` filter — added in
-- 20260805090020_extend_analysis_tasks_lifecycle.sql, unused until now —
-- was ever meant to stop this). Reproduced against real data for user
-- 75b24caf-0b80-498a-bffc-84285a1c8805: 5 CV versions, 5 simultaneously
-- pending tasks.
--
-- Fix: replace_cv() now supersedes (superseded_at = now(), never deleted,
-- never a status change) every still-unfinished (pending/processing) task
-- belonging to this user's OTHER cv_ids, in the same transaction as the
-- replacement itself. Scoped by user_id rather than only v_old.id so this
-- is also self-healing against any pre-existing accumulation (like the
-- real-data case above) the first time that user replaces their CV again,
-- not just preventive for brand-new replacements. Completed/failed tasks,
-- and any task already superseded, are left untouched — only pending/
-- processing rows for a different cv_id are affected. The task for the
-- newly-inserted active CV (v_new.id) is explicitly excluded, so exactly
-- the one task create_analysis_task just created (when v_had_active) is
-- left eligible afterward.
--
-- create_analysis_task() itself is unchanged — its existing idempotent
-- "reuse the active task for this cv_id" behavior and the
-- analysis_tasks_one_active_per_cv partial unique index are both still
-- exactly what they were; this migration only adds the missing cross-
-- version supersession step to replace_cv().
--
-- The remainder of the function body (PDF-only guard, row locking,
-- versioning) is identical to 20260811090000_restrict_cv_to_pdf.sql.
create or replace function public.replace_cv(
  p_storage_path    text,
  p_file_name       text,
  p_file_size_bytes integer,
  p_mime_type       text
)
returns public.cvs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id   uuid := auth.uid();
  v_old       public.cvs;
  v_new       public.cvs;
  v_had_active boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Server-side MIME-type guard. DOCX/DOC can be re-enabled here once a
  -- verified plain-text extractor is confirmed in the n8n environment.
  if p_mime_type <> 'application/pdf' then
    raise exception 'Only PDF uploads are supported. Received: %', p_mime_type
      using errcode = 'check_violation';
  end if;

  if p_storage_path is null or p_storage_path not like (v_user_id::text || '/%') then
    raise exception 'storage_path must be scoped to the authenticated user''s own folder.';
  end if;

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

  if v_had_active then
    perform public.create_analysis_task(v_user_id, v_new.id, 'cv_replaced');
  end if;

  -- Supersede any still-unfinished analysis tasks left behind by this
  -- user's other CV versions. Ordinarily that's just the one task tied to
  -- v_old.id, but this is scoped to user_id (not v_old.id alone) so it
  -- also cleans up any older, previously-unsupersede tasks in one pass.
  -- Never touches the row for v_new.id (the task just created above, if
  -- any) or any task whose status is already terminal (completed/failed)
  -- or already superseded.
  update public.analysis_tasks
  set superseded_at = now()
  where user_id = v_user_id
    and cv_id <> v_new.id
    and status in ('pending', 'processing')
    and superseded_at is null;

  return v_new;
end;
$$;

revoke execute on function public.replace_cv(text, text, integer, text) from public;
grant execute on function public.replace_cv(text, text, integer, text) to authenticated;
