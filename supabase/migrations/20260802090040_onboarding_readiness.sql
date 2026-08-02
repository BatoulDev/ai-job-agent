-- get_onboarding_readiness: the single trusted source of truth for "is
-- this user ready for CV analysis / job matching," used instead of any
-- frontend-only flag. Always evaluates the *calling* user (auth.uid()) —
-- there is no user_id parameter, so it can never be pointed at someone
-- else's data.
--
-- Deliberately security invoker (the default, not security definer): it
-- only ever reads rows the calling user is already allowed to read under
-- the existing "select own" RLS policies on profiles/cvs/job_preferences/
-- subscriptions/analysis_tasks and the cv_objects_select_own storage
-- policy. No elevated privilege is needed or granted.
create or replace function public.get_onboarding_readiness()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles;
  v_cv public.cvs;
  v_prefs public.job_preferences;
  v_subscription public.subscriptions;
  v_cv_storage_object_exists boolean := false;
  v_plan_eligible boolean := false;
  v_preferences_complete boolean := false;
  v_has_active_task boolean := false;
  v_next_step text;
begin
  if v_user_id is null then
    return jsonb_build_object('authenticated', false, 'next_step', 'login');
  end if;

  select * into v_profile from public.profiles where id = v_user_id;
  select * into v_cv from public.cvs where user_id = v_user_id;
  select * into v_prefs from public.job_preferences where user_id = v_user_id;
  select * into v_subscription from public.subscriptions where user_id = v_user_id;

  if v_cv.storage_path is not null then
    select exists(
      select 1 from storage.objects
      where bucket_id = 'cvs' and name = v_cv.storage_path
    ) into v_cv_storage_object_exists;
  end if;

  if v_subscription.status = 'active'
     and (v_subscription.current_period_end is null or v_subscription.current_period_end > now())
  then
    v_plan_eligible := true;
  end if;

  v_preferences_complete := v_prefs.remote_preference is not null
    and v_prefs.job_type is not null
    and v_prefs.experience_level is not null;

  if v_cv.id is not null then
    select exists(
      select 1 from public.analysis_tasks
      where cv_id = v_cv.id and status in ('pending', 'processing')
    ) into v_has_active_task;
  end if;

  v_next_step := case
    when v_profile.id is null then 'profile_missing'
    when not v_plan_eligible then 'plan'
    when v_cv.id is null or not v_cv_storage_object_exists then 'upload_cv'
    when not v_preferences_complete then 'preferences'
    else 'dashboard'
  end;

  return jsonb_build_object(
    'authenticated', true,
    'has_profile', v_profile.id is not null,
    'has_cv', v_cv.id is not null,
    'cv_storage_object_exists', v_cv_storage_object_exists,
    'cv_id', v_cv.id,
    'has_preferences', v_prefs.id is not null,
    'preferences_complete', v_preferences_complete,
    'plan_code', v_subscription.plan_code,
    'subscription_status', v_subscription.status,
    'plan_eligible', v_plan_eligible,
    'has_active_analysis_task', v_has_active_task,
    'onboarding_complete', v_next_step = 'dashboard',
    'next_step', v_next_step
  );
end;
$$;

revoke execute on function public.get_onboarding_readiness() from public;
grant execute on function public.get_onboarding_readiness() to authenticated;
