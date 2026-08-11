-- Adds a server-side PDF-only guard to replace_cv(). The client already
-- restricts ACCEPTED_FORMATS and ALLOWED_MIME_TYPES, but the RPC was the
-- only write path for CVs and it previously accepted any MIME type. This
-- closes the gap: a request that bypasses client-side validation (curl,
-- tampered request, future DOCX re-enablement without removing this check)
-- is rejected before any row is written.
--
-- The remainder of the function body is identical to
-- 20260809090010_resolve_cvs_versioning_conflict.sql. Changing only the
-- guard avoids accidentally drifting other RPC logic.
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

  return v_new;
end;
$$;

revoke execute on function public.replace_cv(text, text, integer, text) from public;
grant execute on function public.replace_cv(text, text, integer, text) to authenticated;
