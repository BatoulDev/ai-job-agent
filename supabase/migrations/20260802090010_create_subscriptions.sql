-- subscriptions: one current subscription state per user (not a history
-- log — payment_attempts is where full payment history lives, see the
-- next migration). Every user gets a trusted 'free' row automatically at
-- signup, the same way profiles rows are created — never by client insert.
--
-- Ownership boundary: user_id references auth.users.id, exactly like
-- profiles/job_preferences/cvs. plan_code references the canonical
-- public.plans catalog, so a subscription can never point at an unknown
-- or invented plan.
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  plan_code text not null references public.plans (plan_code),
  status text not null default 'inactive' check (status in ('inactive', 'pending', 'active', 'expired', 'cancelled')),
  provider text not null check (provider in ('free', 'whish')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  activated_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  provider_customer_id text,
  provider_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Only the free plan may use provider 'free'; every paid plan must be
  -- backed by a real payment provider (whish is the only one approved).
  constraint subscriptions_provider_matches_plan check (
    (plan_code = 'free' and provider = 'free')
    or (plan_code <> 'free' and provider = 'whish')
  )
);

comment on table public.subscriptions is
  'One current subscription row per auth.users id. Status/plan transitions for paid plans are only ever performed by trusted server-side code (see activate_subscription/expire_subscription/cancel_subscription below) — never by direct client update.';

alter table public.subscriptions enable row level security;

create trigger set_subscriptions_updated_at
  before update on public.subscriptions
  for each row
  execute function public.set_updated_at();

-- Users may read only their own subscription. No insert/update/delete
-- policy exists for the authenticated role at all: a user can never
-- create, upgrade, activate, or retarget a subscription via the client.
create policy "subscriptions_select_own"
  on public.subscriptions
  for select
  to authenticated
  using (auth.uid() = user_id);

grant select on public.subscriptions to authenticated;

-- Automatically gives every new user a trusted, active Free entitlement —
-- no payment, no client action, no window for a user to grant themselves
-- a paid plan by racing this trigger. Mirrors handle_new_user's pattern
-- (security definer, bypasses RLS for this one controlled insert path).
create or replace function public.handle_new_user_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.subscriptions (user_id, plan_code, status, provider, activated_at)
  values (new.id, 'free', 'active', 'free', now());
  return new;
end;
$$;

create trigger on_auth_user_created_subscription
  after insert on auth.users
  for each row
  execute function public.handle_new_user_subscription();

-- Trusted server-side transition functions. These are the ONLY way a
-- subscription can move to/through a paid state. Execute is revoked from
-- every client-facing role and granted only to service_role, so even a
-- user with a valid authenticated JWT gets a permission error at the
-- Postgres grant layer before RLS is ever relevant. Only server code using
-- the service-role client (src/lib/supabase/admin.ts, never imported by
-- anything that ships to the browser) may call these.
create or replace function public.activate_subscription(
  p_user_id uuid,
  p_plan_code text,
  p_provider text,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.subscriptions;
begin
  if p_plan_code = 'free' then
    raise exception 'activate_subscription cannot be used for the free plan';
  end if;

  update public.subscriptions
  set
    plan_code = p_plan_code,
    status = 'active',
    provider = p_provider,
    provider_customer_id = p_provider_customer_id,
    provider_subscription_id = p_provider_subscription_id,
    current_period_start = p_period_start,
    current_period_end = p_period_end,
    activated_at = now()
  where user_id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'No subscription row exists for user %', p_user_id;
  end if;

  return v_row;
end;
$$;

create or replace function public.expire_subscription(p_user_id uuid)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.subscriptions;
begin
  update public.subscriptions
  set status = 'expired', expired_at = now()
  where user_id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'No subscription row exists for user %', p_user_id;
  end if;

  return v_row;
end;
$$;

create or replace function public.cancel_subscription(p_user_id uuid)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.subscriptions;
begin
  update public.subscriptions
  set status = 'cancelled', cancelled_at = now()
  where user_id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'No subscription row exists for user %', p_user_id;
  end if;

  return v_row;
end;
$$;

revoke execute on function public.activate_subscription(uuid, text, text, text, text, timestamptz, timestamptz) from public;
revoke execute on function public.expire_subscription(uuid) from public;
revoke execute on function public.cancel_subscription(uuid) from public;

grant execute on function public.activate_subscription(uuid, text, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.expire_subscription(uuid) to service_role;
grant execute on function public.cancel_subscription(uuid) to service_role;
