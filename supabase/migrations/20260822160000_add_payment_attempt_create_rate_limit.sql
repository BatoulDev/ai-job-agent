-- Closes the checkout/payment-creation gap found during the rate-limiting
-- review (2026-08-22): create_payment_attempt() (20260802090020_create_
-- payment_attempts.sql) already reuses any in-flight ('created'/'pending')
-- attempt for the same (user, plan_code) — real idempotency, preventing a
-- page refresh from ever creating a duplicate payment session — but had no
-- bound at all on how many genuinely new attempts a user could create
-- (e.g. across different plans, or after each one is cancelled/expired),
-- which is a real cost/abuse surface once this reaches a live payment
-- provider.
--
-- Reuses the existing rate_limit_events table and its established pattern
-- (see charge_feedback_task_quota / replace_cv in 20260821090000_add_ai_
-- task_and_cv_replace_rate_limits.sql): an advisory lock scoped to this
-- user and action, charged only when a genuinely NEW attempt is inserted —
-- never on a reuse of an in-flight attempt, so the idempotency guarantee
-- above is completely unaffected by this quota.
alter table public.rate_limit_events
  drop constraint rate_limit_events_action_check,
  add constraint rate_limit_events_action_check
    check (action in ('cv_replace', 'feedback_task_create', 'payment_attempt_create'));

create or replace function public.create_payment_attempt(p_plan_code text)
returns public.payment_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.plans;
  v_existing public.payment_attempts;
  v_row public.payment_attempts;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_plan
  from public.plans
  where plan_code = p_plan_code and is_active = true and plan_code <> 'free';

  if not found then
    raise exception 'Unknown or non-payable plan code: %', p_plan_code;
  end if;

  -- Serializes this user's payment-attempt creation so the reuse-check and
  -- the quota-check-then-insert below are atomic under concurrency —
  -- released automatically at transaction end.
  perform pg_advisory_xact_lock(hashtext('payment_attempt_create:' || v_user_id::text)::bigint);

  select * into v_existing
  from public.payment_attempts
  where user_id = v_user_id
    and plan_code = p_plan_code
    and status in ('created', 'pending')
  order by created_at desc
  limit 1;

  if found then
    return v_existing;
  end if;

  -- Quota applies only from here on — a reused in-flight attempt above
  -- never reaches this check, so idempotent page refreshes are never
  -- affected by it.
  if (
    select count(*) from public.rate_limit_events
    where user_id = v_user_id
      and action = 'payment_attempt_create'
      and created_at > now() - interval '1 hour'
  ) >= 10 then
    raise sqlstate 'PT429'
      using message = 'You''ve started too many checkout attempts recently. Please wait a bit and try again.',
            detail   = 'RATE_LIMITED_PAYMENT_ATTEMPT_CREATE',
            hint     = 'Retry after the 1-hour rolling window has elapsed.';
  end if;

  insert into public.rate_limit_events (user_id, action) values (v_user_id, 'payment_attempt_create');

  insert into public.payment_attempts (user_id, plan_code, amount, currency, provider, status, idempotency_key)
  values (v_user_id, v_plan.plan_code, v_plan.price_amount, v_plan.currency, 'whish', 'created', gen_random_uuid()::text)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.create_payment_attempt(text) from public;
grant execute on function public.create_payment_attempt(text) to authenticated;
