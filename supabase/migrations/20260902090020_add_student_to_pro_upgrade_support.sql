-- Student-to-Pro upgrade support. Adds the one supported paid-path
-- transition not previously representable: an active, in-period Student
-- upgrading to Pro for the verified difference, rather than paying the
-- full Pro price again.
--
-- Design: extends the EXISTING single canonical checkout entrypoint,
-- create_payment_attempt(p_plan_code), rather than adding a parallel
-- "upgrade" RPC/route. /api/checkout already calls create_payment_attempt
-- for both plan codes; a request for 'pro' now transparently receives the
-- discounted amount when (and only when) the server itself — never a
-- client-supplied flag — can verify the caller currently holds an active,
-- in-period, real (paid) Student subscription. Every other case (Free
-- upgrading, an already-Pro user, a lapsed/expired Student, a manually
-- activated subscription with no real paid attempt behind it) falls
-- through to the ordinary full Pro price, unchanged from before this
-- migration.
--
-- This replaces the function body from 20260822160000_add_payment_attempt_
-- create_rate_limit.sql (the latest prior definition — NOT the older
-- 20260806090120_add_student_plan_residence_guard.sql version, which the
-- 08-22 rate-limit migration had already silently superseded, dropping
-- its own-residence guard for the student plan in the process; a
-- pre-existing gap unrelated to this branch, and moot now that outside-
-- Lebanon residence is no longer a supported concept at all — see the
-- branch report). The advisory lock and the existing 10/rolling-hour
-- payment_attempt_create quota are preserved unchanged; the upgrade-credit
-- computation is a read-only step inserted between the idempotent-reuse
-- check and the quota check, so it never affects either.
--
-- Idempotency and no-double-upgrade are inherited from the existing
-- mechanisms, not reimplemented:
--   - In-flight duplicate: the existing "reuse an existing created/pending
--     attempt for this plan_code" check (unchanged) still applies.
--   - Cannot re-discount after success: activate_subscription (called by
--     the existing mark_payment_verified, also unchanged) sets plan_code
--     to 'pro' — a second create_payment_attempt('pro') call after that
--     point no longer finds an active Student subscription, so it can
--     never compute a second discount.
--   - Cannot double-charge: mark_payment_verified already returns the
--     existing row as-is when status is already 'paid', regardless of how
--     many times a provider callback/webhook fires.
--
-- payment_attempts gains two additive, nullable/defaulted columns purely
-- for an immutable audit trail of what was actually verified at the time:
-- is_upgrade (was this attempt computed as a Student-to-Pro upgrade) and
-- credit_amount (the exact Student credit subtracted, when applicable).
-- Neither column is ever written by anything other than
-- create_payment_attempt itself.
alter table public.payment_attempts
  add column is_upgrade boolean not null default false,
  add column credit_amount numeric(10, 2) check (credit_amount is null or credit_amount >= 0);

comment on column public.payment_attempts.is_upgrade is
  'true only when create_payment_attempt computed this attempt as a verified Student-to-Pro upgrade (discounted amount). Never set by anything else — immutable audit trail, not a client-supplied flag.';
comment on column public.payment_attempts.credit_amount is
  'The Student payment credit subtracted from the full Pro price for an upgrade attempt (is_upgrade = true). Null for a non-upgrade attempt. Sourced only from a real, verified (status = paid) prior Student payment_attempts row for this user within the current subscription period — never fabricated.';

create or replace function public.create_payment_attempt(p_plan_code text)
returns public.payment_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.plans;
  v_subscription public.subscriptions;
  v_credit numeric(10, 2);
  v_amount numeric(10, 2);
  v_is_upgrade boolean := false;
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
  -- released automatically at transaction end. Unchanged from
  -- 20260822160000.
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

  v_amount := v_plan.price_amount;

  -- Student-to-Pro upgrade detection (new). Only ever reduces price when
  -- every condition is independently verified server-side:
  --   1. p_plan_code = 'pro' (the only supported upgrade target).
  --   2. The caller's CURRENT subscription (never a client-supplied plan)
  --      is plan_code = 'student', status = 'active'.
  --   3. That subscription is still within its current billing period
  --      (current_period_end in the future) — an expired/lapsed Student
  --      entitlement gets no credit.
  --   4. A real, verified (status = 'paid') Student payment exists for
  --      this user, timestamped at or after the current period's start —
  --      never fabricated, never assumed from an unverified/manually
  --      activated subscription row.
  if p_plan_code = 'pro' then
    select * into v_subscription from public.subscriptions where user_id = v_user_id;

    if v_subscription.plan_code = 'student'
       and v_subscription.status = 'active'
       and v_subscription.current_period_end is not null
       and v_subscription.current_period_end > now()
    then
      select amount into v_credit
      from public.payment_attempts
      where user_id = v_user_id
        and plan_code = 'student'
        and status = 'paid'
        and verified_at is not null
        and (v_subscription.current_period_start is null or verified_at >= v_subscription.current_period_start)
      order by verified_at desc
      limit 1;

      if v_credit is not null then
        v_is_upgrade := true;
        v_amount := greatest(v_plan.price_amount - v_credit, 0);
      end if;
      -- No matching verified Student payment found (e.g. a manually
      -- activated test/free-of-charge subscription): fall through to the
      -- full Pro price rather than inventing an unverified discount.
    end if;
  end if;

  -- Quota applies only from here on — a reused in-flight attempt above
  -- never reaches this check, so idempotent page refreshes are never
  -- affected by it. Unchanged from 20260822160000; an upgrade attempt
  -- consumes the same shared quota as any other new attempt.
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

  insert into public.payment_attempts (
    user_id, plan_code, amount, currency, provider, status, idempotency_key,
    is_upgrade, credit_amount
  )
  values (
    v_user_id, v_plan.plan_code, v_amount, v_plan.currency, 'whish', 'created', gen_random_uuid()::text,
    v_is_upgrade, v_credit
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.create_payment_attempt is
  'Canonical, sole entrypoint for starting a paid-plan checkout attempt, for a fresh purchase (Free/no subscription -> Student or Pro) and a Student-to-Pro upgrade alike. Amount/currency always come from public.plans and, for a verified in-period Student upgrading to Pro, a real prior paid Student payment_attempts row — never from the caller. Idempotent: an in-flight created/pending attempt for the same plan_code is reused rather than duplicated (never quota-charged). Bounded by the existing payment_attempt_create quota (10/rolling hour/user).';

revoke execute on function public.create_payment_attempt(text) from public;
grant execute on function public.create_payment_attempt(text) to authenticated;
