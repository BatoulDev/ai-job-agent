-- payment_attempts: full history of checkout attempts for paid plans.
-- Never destroyed or overwritten on plan change — subscriptions holds only
-- the current state, this table holds the audit trail.
--
-- amount/currency are always copied from public.plans at attempt-creation
-- time (see create_payment_attempt below) — never accepted from the
-- browser. A payment-provider return/callback URL is not proof of
-- payment; only mark_payment_verified (trusted server code only) may set
-- status = 'paid'.
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_code text not null references public.plans (plan_code),
  amount numeric(10, 2) not null check (amount >= 0),
  currency text not null,
  provider text not null check (provider in ('whish')),
  status text not null default 'created' check (status in ('created', 'pending', 'paid', 'failed', 'cancelled', 'expired', 'refunded')),
  idempotency_key text not null,
  provider_payment_id text,
  checkout_url text,
  verified_at timestamptz,
  failure_code text,
  failure_message text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_attempts_not_for_free_plan check (plan_code <> 'free'),
  constraint payment_attempts_user_idempotency_key_unique unique (user_id, idempotency_key)
);

comment on table public.payment_attempts is
  'Full history of paid-plan checkout attempts. status only ever reaches paid through mark_payment_verified, called by trusted server code after real provider verification — never by client update, never by a return/callback URL alone.';

create index payment_attempts_user_id_idx on public.payment_attempts (user_id);

alter table public.payment_attempts enable row level security;

create trigger set_payment_attempts_updated_at
  before update on public.payment_attempts
  for each row
  execute function public.set_updated_at();

-- Users may read their own payment history (for a future "billing" view).
-- No insert/update/delete policy exists for the authenticated role — rows
-- are only ever created via create_payment_attempt and only ever updated
-- via mark_payment_verified / mark_payment_failed below.
create policy "payment_attempts_select_own"
  on public.payment_attempts
  for select
  to authenticated
  using (auth.uid() = user_id);

grant select on public.payment_attempts to authenticated;

-- Creates (or, if one is already in flight, reuses) a payment attempt for
-- the calling user and a paid plan. Idempotent by design: a page refresh
-- during checkout returns the same 'created'/'pending' attempt instead of
-- creating a duplicate. Amount/currency always come from public.plans —
-- the plan_code argument is validated against that table, nothing about
-- price is ever taken from the caller.
--
-- security definer is required because there is no insert policy for the
-- authenticated role; this function is the sole, tightly-scoped insert
-- path, and it always uses auth.uid() for ownership, never a parameter.
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

  insert into public.payment_attempts (user_id, plan_code, amount, currency, provider, status, idempotency_key)
  values (v_user_id, v_plan.plan_code, v_plan.price_amount, v_plan.currency, 'whish', 'created', gen_random_uuid()::text)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.create_payment_attempt(text) from public;
grant execute on function public.create_payment_attempt(text) to authenticated;

-- Trusted server-only confirmation path. Marks a payment attempt paid and
-- atomically activates the corresponding subscription in the same
-- transaction, so the two can never disagree (an attempt marked paid with
-- no active subscription, or vice versa). service_role only.
create or replace function public.mark_payment_verified(
  p_payment_attempt_id uuid,
  p_provider_payment_id text,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns public.payment_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.payment_attempts;
begin
  select * into v_attempt
  from public.payment_attempts
  where id = p_payment_attempt_id
  for update;

  if not found then
    raise exception 'No payment attempt %', p_payment_attempt_id;
  end if;

  if v_attempt.status = 'paid' then
    -- Already verified: return as-is rather than re-activating, so a
    -- duplicate provider notification can never double-process.
    return v_attempt;
  end if;

  if v_attempt.status not in ('created', 'pending') then
    raise exception 'Payment attempt % is in terminal status % and cannot be verified', p_payment_attempt_id, v_attempt.status;
  end if;

  update public.payment_attempts
  set status = 'paid', provider_payment_id = p_provider_payment_id, verified_at = now()
  where id = p_payment_attempt_id
  returning * into v_attempt;

  perform public.activate_subscription(
    v_attempt.user_id,
    v_attempt.plan_code,
    v_attempt.provider,
    null,
    p_provider_payment_id,
    p_period_start,
    p_period_end
  );

  return v_attempt;
end;
$$;

create or replace function public.mark_payment_failed(
  p_payment_attempt_id uuid,
  p_status text,
  p_failure_code text,
  p_failure_message text
)
returns public.payment_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.payment_attempts;
begin
  if p_status not in ('failed', 'cancelled', 'expired') then
    raise exception 'Invalid terminal status: %', p_status;
  end if;

  update public.payment_attempts
  set status = p_status, failure_code = p_failure_code, failure_message = p_failure_message
  where id = p_payment_attempt_id and status in ('created', 'pending')
  returning * into v_row;

  if not found then
    raise exception 'No pending/created payment attempt % to fail', p_payment_attempt_id;
  end if;

  return v_row;
end;
$$;

revoke execute on function public.mark_payment_verified(uuid, text, timestamptz, timestamptz) from public;
revoke execute on function public.mark_payment_failed(uuid, text, text, text) from public;

grant execute on function public.mark_payment_verified(uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function public.mark_payment_failed(uuid, text, text, text) to service_role;
