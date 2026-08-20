-- Provides a safe, authenticated path for users to update their own
-- profiles.full_name and immediately queue a re-analysis of their active CV
-- so ownership validation runs again with the corrected name.
--
-- Why SECURITY DEFINER: the function must call create_analysis_task(), which
-- is itself SECURITY DEFINER and restricted to service_role. A SECURITY
-- DEFINER outer function running as its owner (postgres) can call it.
--
-- Why the authenticated role can call this: the body derives the acting user
-- exclusively from auth.uid() — a client-supplied user_id is never accepted.
-- The RLS policy on profiles (profiles_update_own) is bypassed by SECURITY
-- DEFINER, but the WHERE id = v_user_id clause enforces the same invariant.
create or replace function public.update_profile_name_and_retry_analysis(
  p_full_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_trimmed  text;
  v_cv_id    uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  v_trimmed := trim(p_full_name);
  if v_trimmed = '' then
    raise exception 'Name cannot be empty.';
  end if;
  if char_length(v_trimmed) > 200 then
    raise exception 'Name must not exceed 200 characters.';
  end if;

  update public.profiles
    set full_name = v_trimmed
  where id = v_user_id;

  -- Find the user's current active CV. The unique partial index on
  -- cvs(user_id) WHERE is_active = true guarantees at most one row.
  select id into v_cv_id
  from public.cvs
  where user_id = v_user_id
    and is_active = true
  order by created_at desc
  limit 1;

  -- Queue or return the existing pending/processing task (idempotent via
  -- create_analysis_task's internal conflict-handling logic).
  if v_cv_id is not null then
    perform public.create_analysis_task(v_user_id, v_cv_id, 'user_request');
  end if;

  return jsonb_build_object(
    'ok',              true,
    'has_active_task', v_cv_id is not null
  );
end;
$$;

-- Grant to authenticated: callers must still have a valid session and
-- auth.uid() must resolve to a real user — anonymous callers are rejected
-- inside the function body.
revoke execute on function public.update_profile_name_and_retry_analysis(text) from public;
grant execute on function public.update_profile_name_and_retry_analysis(text) to authenticated;
