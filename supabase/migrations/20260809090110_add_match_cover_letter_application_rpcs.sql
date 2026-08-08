-- The small set of user-facing write RPCs matches/cover_letters/
-- applications need to be usable at all, given none of them grant
-- authenticated any direct insert/update (Section 17's "nothing may be
-- sent without explicit user approval" boundary applies just as much to
-- approving a match/cover-letter as to sending). No worker, matching
-- algorithm, or cover-letter generator is built here — these RPCs only
-- let a user approve/reject/edit rows a future worker will have created.

create or replace function public.approve_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.matches;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from public.matches where id = p_match_id and user_id = v_user_id for update;
  if not found then
    raise exception 'Match not found.';
  end if;

  if v_row.status = 'user_approved' then
    return v_row; -- idempotent no-op
  end if;

  if v_row.status <> 'pending_review' then
    raise exception 'This match has already been decided.';
  end if;

  update public.matches
  set status = 'user_approved', decided_at = now()
  where id = p_match_id
  returning * into v_row;

  insert into public.audit_events (user_id, actor_type, event_type, entity_type, entity_id)
  values (v_user_id, 'user', 'match_approved', 'match', p_match_id);

  return v_row;
end;
$$;

revoke execute on function public.approve_match(uuid) from public;
grant execute on function public.approve_match(uuid) to authenticated;

create or replace function public.reject_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.matches;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from public.matches where id = p_match_id and user_id = v_user_id for update;
  if not found then
    raise exception 'Match not found.';
  end if;

  if v_row.status = 'user_rejected' then
    return v_row; -- idempotent no-op
  end if;

  if v_row.status <> 'pending_review' then
    raise exception 'This match has already been decided.';
  end if;

  update public.matches
  set status = 'user_rejected', decided_at = now()
  where id = p_match_id
  returning * into v_row;

  insert into public.audit_events (user_id, actor_type, event_type, entity_type, entity_id)
  values (v_user_id, 'user', 'match_rejected', 'match', p_match_id);

  return v_row;
end;
$$;

revoke execute on function public.reject_match(uuid) from public;
grant execute on function public.reject_match(uuid) to authenticated;

create or replace function public.save_cover_letter_edit(
  p_cover_letter_id uuid,
  p_edited_content text
)
returns public.cover_letters
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.cover_letters;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from public.cover_letters where id = p_cover_letter_id and user_id = v_user_id for update;
  if not found then
    raise exception 'Cover letter not found.';
  end if;

  if v_row.approval_status = 'user_approved' then
    raise exception 'This cover letter has already been approved and can no longer be edited.';
  end if;

  update public.cover_letters
  set edited_content = p_edited_content, revision = revision + 1
  where id = p_cover_letter_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.save_cover_letter_edit(uuid, text) from public;
grant execute on function public.save_cover_letter_edit(uuid, text) to authenticated;

-- Freezes whichever content the user currently has (their latest edit, or
-- the original AI draft if never edited) into approved_content.
create or replace function public.approve_cover_letter(p_cover_letter_id uuid)
returns public.cover_letters
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.cover_letters;
  v_final text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from public.cover_letters where id = p_cover_letter_id and user_id = v_user_id for update;
  if not found then
    raise exception 'Cover letter not found.';
  end if;

  if v_row.approval_status = 'user_approved' then
    return v_row; -- idempotent no-op — approved_content is already frozen
  end if;

  v_final := coalesce(v_row.edited_content, v_row.generated_content);
  if v_final is null then
    raise exception 'This cover letter has no content to approve yet.';
  end if;

  update public.cover_letters
  set approval_status = 'user_approved', approved_content = v_final, approved_at = now()
  where id = p_cover_letter_id
  returning * into v_row;

  insert into public.audit_events (user_id, actor_type, event_type, entity_type, entity_id)
  values (v_user_id, 'user', 'cover_letter_approved', 'cover_letter', p_cover_letter_id);

  return v_row;
end;
$$;

revoke execute on function public.approve_cover_letter(uuid) from public;
grant execute on function public.approve_cover_letter(uuid) to authenticated;

-- The "user clicks Send" moment: creates the approved application row a
-- future sender can later claim. Never sends anything itself. Idempotent
-- like create_analysis_task — a duplicate call for the same match reuses
-- the existing active row rather than erroring or duplicating.
create or replace function public.create_application(p_match_id uuid)
returns public.applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_match public.matches;
  v_job public.jobs;
  v_cover_letter_id uuid;
  v_row public.applications;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_match from public.matches where id = p_match_id and user_id = v_user_id for update;
  if not found then
    raise exception 'Match not found.';
  end if;

  if v_match.status <> 'user_approved' then
    raise exception 'You must approve this match before it can be sent.';
  end if;

  select * into v_row
  from public.applications
  where match_id = p_match_id and status in ('pending_send', 'sending', 'sent')
  limit 1;
  if found then
    return v_row; -- idempotent: an active application already exists
  end if;

  select * into v_job from public.jobs where id = v_match.job_id;
  if not found then
    raise exception 'Job no longer exists.';
  end if;

  -- A cover letter is required only when the job actually needs one
  -- composed (email sending); a pure external-link job (including every
  -- LinkedIn listing) may proceed with prepared materials only.
  if v_job.application_method = 'email' then
    select id into v_cover_letter_id
    from public.cover_letters
    where match_id = p_match_id and approval_status = 'user_approved';
    if v_cover_letter_id is null then
      raise exception 'You must approve a cover letter before this application can be sent.';
    end if;
  else
    select id into v_cover_letter_id from public.cover_letters where match_id = p_match_id;
  end if;

  insert into public.applications (
    user_id, match_id, job_id, cover_letter_id, application_method,
    approved_at, approved_by, idempotency_key
  )
  values (
    v_user_id, p_match_id, v_match.job_id, v_cover_letter_id, v_job.application_method,
    now(), v_user_id, p_match_id::text || ':' || gen_random_uuid()::text
  )
  returning * into v_row;

  insert into public.audit_events (user_id, actor_type, event_type, entity_type, entity_id)
  values (v_user_id, 'user', 'application_approved', 'application', v_row.id);

  return v_row;
end;
$$;

revoke execute on function public.create_application(uuid) from public;
grant execute on function public.create_application(uuid) to authenticated;
