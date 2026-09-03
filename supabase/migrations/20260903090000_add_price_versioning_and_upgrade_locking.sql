-- Price versioning: makes "which Student/Pro prices belong together" an
-- explicit, queryable fact instead of "whatever public.plans.price_amount
-- says right now" — required so a Student-to-Pro upgrade mid-period (and,
-- eventually, a renewal) can be quoted from the SAME locked price
-- schedule the customer's current paid period actually used, even after
-- the public price later changes.
--
-- This corrects a real gap in create_payment_attempt as it stood after
-- 20260902090020_add_student_to_pro_upgrade_support.sql: that version
-- computed an upgrade's amount as
--   (CURRENT public.plans.price_amount for 'pro') - (the Student's actual
--   paid amount)
-- which is only correct as long as the public Pro price never changes
-- between the Student's purchase and the upgrade. A price change in
-- between would silently charge the wrong amount (the new Pro price minus
-- the old Student credit) instead of the two prices from the SAME
-- original schedule. This migration adds the version lock and rewrites
-- create_payment_attempt to use it.
--
-- Design (dependency order below):
--   1. price_versions + plan_prices: the new canonical "what a plan
--      COSTS at a point in time" tables. public.plans is unchanged and
--      keeps its existing job — what a plan IS (display name, feature
--      limits, is_active, billing_period) plus its current display price
--      (price_amount/currency), which remains the marketing-copy contract
--      with src/components/landing/Pricing.tsx and must still be kept in
--      sync by hand whenever a new price version is activated (documented
--      on plans.price_amount below) — exactly the same discipline that
--      already existed before this migration, just now also mirrored into
--      plan_prices as the row checkout logic actually reads.
--   2. payment_attempts/subscriptions gain price_version_id (+ a fuller
--      immutable purchase snapshot on payment_attempts) and are backfilled
--      to the one schedule that has ever existed.
--   3. get_active_price_version(): the single source of "what's on sale
--      now" — every fresh purchase and renewal quotes from here.
--   4. quote_student_to_pro_upgrade(): pure, read-only quotation,
--      separated from attempt creation (AGENTS.md: quotation and
--      payment-attempt creation are different concepts). Both the credit
--      and the destination Pro price come from the customer's LOCKED
--      price_version_id, never the live active version.
--   5. create_payment_attempt: rewritten to consume both of the above,
--      classify purchase_type (initial/renewal/upgrade), and reject a
--      Pro customer purchasing Student (no downgrade path, ever).
--   6. activate_subscription / mark_payment_verified: activate_subscription
--      gains a new trailing parameter (old 7-arg signature explicitly
--      dropped first — CREATE OR REPLACE cannot append a parameter in
--      place, it creates a second overload — so exactly one signature
--      exists; this function has never been client-facing, service_role
--      only, so no PostgREST/caller compatibility concern). Both
--      functions together lock subscriptions.price_version_id and
--      preserve an immutable period_start/period_end on the
--      payment_attempts row itself, independent of subscriptions' mutable
--      current period. mark_payment_verified's own signature is
--      unchanged, but its billing-period computation is now
--      purchase_type-driven rather than caller-trusted (see its body):
--      an upgrade preserves the subscription's existing period exactly;
--      a renewal begins exactly at the existing current_period_end for
--      one billing_period, never at "now" and never from a caller-
--      supplied date — p_period_start/p_period_end are used only for an
--      initial purchase, where no prior period exists to derive from.
--      payment_attempts also gains a uniqueness constraint on
--      (provider, provider_payment_id) — previously unconstrained, so two
--      different attempts could both be marked 'paid' against the same
--      real-world provider reference.
--   7. Early renewal: a renewal verified BEFORE current_period_end must
--      never touch current_period_start/end (would prematurely discard
--      paid-for time). subscriptions gains next_period_start/end/
--      next_price_version_id to queue it instead; promote_due_
--      subscription_period() physically promotes the queue once it is
--      actually due, called opportunistically from create_payment_attempt
--      and mark_payment_verified (no cron — this project has none, and
--      this migration deliberately does not add one); get_onboarding_
--      readiness (STABLE, cannot write) mirrors the same "is it due"
--      logic read-only so a plain read in the gap before the next
--      payment-related call is never wrong either way.

-- ── 1. price_versions + plan_prices ───────────────────────────────────────

create table public.price_versions (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  is_active boolean not null default false,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.price_versions is
  'A named, effective-dated price schedule. Exactly one row may have is_active = true at a time (price_versions_one_active_idx) — that is the schedule new checkouts/renewals quote from (see get_active_price_version). Historical purchases and active billing periods keep referencing their original, possibly now-inactive, version forever (payment_attempts.price_version_id, subscriptions.price_version_id) — activating a new version never touches either.';

create unique index price_versions_one_active_idx on public.price_versions (is_active) where is_active;

alter table public.price_versions enable row level security;

create policy "price_versions_select_authenticated"
  on public.price_versions
  for select
  to authenticated
  using (true);

grant select on public.price_versions to authenticated;
-- No insert/update/delete policy for authenticated or anon: activating a
-- new price version is a reviewed migration / service-role operation
-- only, same server-only-write posture as public.plans.
grant select, insert, update, delete on public.price_versions to service_role;

create table public.plan_prices (
  price_version_id uuid not null references public.price_versions (id),
  plan_code text not null references public.plans (plan_code),
  price_amount numeric(10, 2) not null check (price_amount >= 0),
  currency text not null default 'USD',
  billing_period text not null check (billing_period in ('forever', 'monthly')),
  created_at timestamptz not null default now(),
  primary key (price_version_id, plan_code)
);

comment on table public.plan_prices is
  'The locked price for one plan under one price_versions schedule. Treated as immutable once any payment_attempts/subscriptions row references its price_version_id — a price change is always a NEW price_versions row with new plan_prices rows, never an update to an existing one. No update/delete grant exists for any client-facing role; application code must never update this table in place.';

alter table public.plan_prices enable row level security;

create policy "plan_prices_select_authenticated"
  on public.plan_prices
  for select
  to authenticated
  using (true);

grant select on public.plan_prices to authenticated;
grant select, insert, update, delete on public.plan_prices to service_role;

-- Seed price version 1 from today's live public.plans values — the exact,
-- and only, schedule every existing purchase and active subscription has
-- ever actually used. A fixed id keeps this migration's backfill below
-- deterministic and re-runnable.
insert into public.price_versions (id, label, is_active, effective_at)
values ('00000000-0000-0000-0000-000000000001', 'launch-2026-08', true, '2026-08-02T09:00:00Z')
on conflict (id) do nothing;

insert into public.plan_prices (price_version_id, plan_code, price_amount, currency, billing_period)
select '00000000-0000-0000-0000-000000000001', plan_code, price_amount, currency, billing_period
from public.plans
on conflict (price_version_id, plan_code) do nothing;

comment on column public.plans.price_amount is
  'Current DISPLAY price only (marketing-copy contract with src/components/landing/Pricing.tsx). Actual checkout/upgrade/renewal pricing is authoritative from plan_prices under get_active_price_version() as of 20260903090000_add_price_versioning_and_upgrade_locking.sql — when a new price version is activated, update this column in the SAME migration so display and charged price never disagree.';

-- ── 2. payment_attempts / subscriptions: version lock + fuller snapshot ──

alter table public.payment_attempts
  add column price_version_id uuid references public.price_versions (id),
  add column purchase_type text not null default 'initial' check (purchase_type in ('initial', 'renewal', 'upgrade')),
  add column source_plan_code text references public.plans (plan_code),
  add column billing_period text check (billing_period in ('forever', 'monthly')),
  add column period_start timestamptz,
  add column period_end timestamptz,
  add constraint payment_attempts_upgrade_has_source_plan
    check (purchase_type <> 'upgrade' or source_plan_code is not null),
  -- provider_payment_id (column predates this migration,
  -- 20260802090020_create_payment_attempts.sql) had no uniqueness
  -- constraint at all: two DIFFERENT payment_attempts rows could both be
  -- marked 'paid' against the exact same real-world provider payment
  -- reference — nothing enforced "provider references are unique". A
  -- standard multi-column unique constraint treats each NULL as distinct
  -- (Postgres semantics), so every not-yet-verified attempt (the common
  -- case) is completely unaffected — this only ever activates once
  -- provider_payment_id is actually set, by mark_payment_verified.
  add constraint payment_attempts_provider_payment_id_unique
    unique (provider, provider_payment_id);

comment on column public.payment_attempts.price_version_id is
  'The price_versions schedule this attempt''s amount/credit were computed from. For an initial purchase or renewal, the active version at attempt-creation time. For an upgrade, the customer''s CURRENT subscription''s locked price_version_id (subscriptions.price_version_id) — never the live active version, so a public price change between the Student purchase and the upgrade can never change the upgrade amount. Immutable once set — never updated after insert.';
comment on column public.payment_attempts.purchase_type is
  'initial (first paid-plan purchase from Free), renewal (an already-active subscription paying for the same plan again), or upgrade (Student-to-Pro, see is_upgrade/source_plan_code). renewal is reserved for when automated recurring billing exists; today only a manual re-checkout for an already-active plan can produce it.';
comment on column public.payment_attempts.source_plan_code is
  'Set only when purchase_type = upgrade: the plan_code the customer upgraded FROM (always ''student'' today, the only supported upgrade path). Null otherwise.';
comment on column public.payment_attempts.billing_period is
  'Copied from plan_prices at attempt-creation time — immutable, independent of any later change to plans.billing_period.';
comment on column public.payment_attempts.period_start is
  'Copied from the p_period_start passed to mark_payment_verified at verification time: an immutable record of the billing period THIS payment purchased, independent of subscriptions.current_period_start, which is overwritten by the next renewal/upgrade.';
comment on column public.payment_attempts.period_end is
  'See period_start. Immutable historical record, independent of subscriptions.current_period_end.';

-- Backfill: every payment_attempts row that predates this migration was,
-- in fact, priced from exactly the one schedule that has ever existed —
-- a safe, evidence-based backfill, not a guess.
update public.payment_attempts
set price_version_id = '00000000-0000-0000-0000-000000000001',
    billing_period = (select p.billing_period from public.plans p where p.plan_code = payment_attempts.plan_code),
    purchase_type = case when is_upgrade then 'upgrade' else 'initial' end,
    source_plan_code = case when is_upgrade then 'student' else null end
where price_version_id is null;

alter table public.subscriptions
  add column price_version_id uuid references public.price_versions (id),
  -- Early-renewal support: a renewal paid for BEFORE current_period_end
  -- must never touch current_period_start/end (that would silently
  -- shorten or discard time the customer already has paid access to,
  -- and would misrepresent what period is actually in force right now).
  -- The next, already-paid-for period is queued here instead and only
  -- becomes the current period once current_period_end has genuinely
  -- passed — see promote_due_subscription_period() below, called
  -- opportunistically from create_payment_attempt/mark_payment_verified,
  -- and mirrored read-only in get_onboarding_readiness for the gap
  -- between period-elapse and the next payment-related call. All three
  -- are null together (an on-time/late renewal or a fresh purchase never
  -- populates them at all — only an EARLY renewal does).
  add column next_period_start timestamptz,
  add column next_period_end timestamptz,
  add column next_price_version_id uuid references public.price_versions (id),
  add constraint subscriptions_next_period_start_before_end
    check (next_period_start is null or next_period_end is null or next_period_start < next_period_end);

comment on column public.subscriptions.price_version_id is
  'The price_versions schedule this subscription''s CURRENT paid period is locked to (set by activate_subscription from the activating payment_attempts row). A public price change never updates this — it only changes what the NEXT renewal/upgrade quotes from (get_active_price_version). Null for plan_code = ''free'' (no price to lock).';
comment on column public.subscriptions.next_period_start is
  'Set only by an EARLY renewal (verified before current_period_end): the queued next period''s start, equal to whichever is later of current_period_end or an already-queued next_period_end (so a second early renewal chains onto the first instead of colliding with it). Promoted into current_period_start by promote_due_subscription_period() once current_period_end has passed. Null otherwise.';
comment on column public.subscriptions.next_period_end is
  'See next_period_start. The queued next period''s end (next_period_start + the renewal''s billing_period).';
comment on column public.subscriptions.next_price_version_id is
  'The price_versions schedule the QUEUED next period was actually priced from (may differ from the current price_version_id if the active version changed between this renewal and the previous one). Promoted into price_version_id alongside the period itself.';

update public.subscriptions
set price_version_id = '00000000-0000-0000-0000-000000000001'
where plan_code <> 'free' and price_version_id is null;

-- Idempotent, no-op-when-nothing-due promotion of a queued next period
-- into the current one. Called opportunistically (never on a schedule —
-- there is no cron/background-job infrastructure in this project, and
-- this migration deliberately does not add one) from every payment-
-- related entrypoint, so the row is never more than one interaction
-- stale; get_onboarding_readiness additionally computes the SAME
-- "is it actually due" logic read-only (see below) to stay correct even
-- in the gap before the next such interaction.
create or replace function public.promote_due_subscription_period(p_user_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.subscriptions
  set current_period_start = next_period_start,
      current_period_end = next_period_end,
      price_version_id = coalesce(next_price_version_id, price_version_id),
      next_period_start = null,
      next_period_end = null,
      next_price_version_id = null
  where user_id = p_user_id
    and next_period_end is not null
    and current_period_end is not null
    and now() >= current_period_end;
$$;

comment on function public.promote_due_subscription_period is
  'Physically promotes a queued next_period_* into current_period_* once current_period_end has actually passed. A pure no-op (matches zero rows) if nothing is queued or nothing is due yet — always safe to call unconditionally. Internal-only (no grant to authenticated/anon, called via ownership from create_payment_attempt/mark_payment_verified, both security definer), same posture as the other internal-only helpers in this migration.';

revoke execute on function public.promote_due_subscription_period(uuid) from public;
grant execute on function public.promote_due_subscription_period(uuid) to service_role;

-- ── 3. get_active_price_version(): the single source of "on sale now" ────

create or replace function public.get_active_price_version()
returns public.price_versions
language sql
stable
security invoker
set search_path = ''
as $$
  select * from public.price_versions where is_active = true limit 1;
$$;

comment on function public.get_active_price_version is
  'Returns the single currently-active price schedule (or null if misconfigured). Every fresh (non-upgrade) checkout and renewal quote reads from here — never from an arbitrary/most-recent price_versions row.';

revoke execute on function public.get_active_price_version() from public;
grant execute on function public.get_active_price_version() to authenticated;
grant execute on function public.get_active_price_version() to service_role;

-- ── 4. quote_student_to_pro_upgrade(): pure quotation, no side effects ───
-- Internal-only (no grant to authenticated/anon, mirroring
-- activate_subscription/expire_subscription/cancel_subscription): called
-- solely from create_payment_attempt below, which runs SECURITY DEFINER
-- as this function's owner — ownership alone is sufficient to execute it,
-- exactly like the existing subscription-transition functions. Not
-- exposed directly to authenticated because it accepts an arbitrary
-- p_user_id and would otherwise leak another user's Student/upgrade
-- eligibility and credit amount.
create or replace function public.quote_student_to_pro_upgrade(p_user_id uuid)
returns table (
  amount numeric,
  credit_amount numeric,
  price_version_id uuid,
  currency text,
  billing_period text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_subscription public.subscriptions;
  v_credit numeric(10, 2);
  v_pro_price public.plan_prices;
begin
  select * into v_subscription from public.subscriptions where user_id = p_user_id;

  if v_subscription.plan_code is distinct from 'student'
     or v_subscription.status is distinct from 'active'
     or v_subscription.current_period_end is null
     or v_subscription.current_period_end <= now()
     or v_subscription.price_version_id is null
  then
    return; -- zero rows: not an eligible upgrade candidate, not an error
  end if;

  -- A real, verified (status = paid) Student payment for this user,
  -- timestamped at or after the current period's start — never
  -- fabricated, never assumed from an unverified/manually activated
  -- subscription row. Table-qualified (pa.amount): this function's own
  -- `amount` OUT parameter would otherwise shadow the column and raise
  -- "column reference is ambiguous".
  select pa.amount into v_credit
  from public.payment_attempts pa
  where pa.user_id = p_user_id
    and pa.plan_code = 'student'
    and pa.status = 'paid'
    and pa.verified_at is not null
    and (v_subscription.current_period_start is null or pa.verified_at >= v_subscription.current_period_start)
  order by pa.verified_at desc
  limit 1;

  if v_credit is null then
    return; -- no verified real payment behind this period: no fabricated discount
  end if;

  select * into v_pro_price
  from public.plan_prices pp
  where pp.price_version_id = v_subscription.price_version_id and pp.plan_code = 'pro';

  if not found then
    raise exception 'No Pro price is defined for price version %; cannot quote a Student-to-Pro upgrade.', v_subscription.price_version_id
      using errcode = 'PT500';
  end if;

  amount := greatest(v_pro_price.price_amount - v_credit, 0);
  credit_amount := v_credit;
  price_version_id := v_subscription.price_version_id;
  currency := v_pro_price.currency;
  billing_period := v_pro_price.billing_period;
  return next;
end;
$$;

comment on function public.quote_student_to_pro_upgrade is
  'Pure, read-only quotation for a Student-to-Pro upgrade: both the Student credit and the Pro price come from the customer''s locked price_version_id (their current subscription''s original paid schedule), never the live active price_versions row, so a public price change never changes an in-flight or already-priced upgrade. Returns zero rows when the caller is not a verified, in-period, real-paid Student (not an error — create_payment_attempt treats that as "full price"). Raises PT500 if the locked version has no Pro price at all, so create_payment_attempt can fail safely without inserting a broken attempt. Internal-only: no grant to authenticated (would otherwise leak another user''s upgrade eligibility/credit) — always called from within create_payment_attempt, which runs as this function''s owner.';

revoke execute on function public.quote_student_to_pro_upgrade(uuid) from public;
grant execute on function public.quote_student_to_pro_upgrade(uuid) to service_role;

-- ── 5. create_payment_attempt: version-locked, downgrade-safe ────────────

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
  v_active_version public.price_versions;
  v_plan_price public.plan_prices;
  v_quote record;
  v_amount numeric(10, 2);
  v_currency text;
  v_billing_period text;
  v_credit numeric(10, 2);
  v_price_version_id uuid;
  v_is_upgrade boolean := false;
  v_purchase_type text := 'initial';
  v_source_plan_code text;
  v_existing public.payment_attempts;
  v_row public.payment_attempts;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Physically promote a due-but-not-yet-active queued renewal period
  -- BEFORE reading subscriptions below, so every decision in this
  -- function (the Pro-downgrade guard, the renewal/upgrade classification,
  -- quote_student_to_pro_upgrade's own read) sees the customer's true
  -- current plan/period, never a stale row left over from an earlier
  -- early renewal. A no-op when nothing is due.
  perform public.promote_due_subscription_period(v_user_id);

  select * into v_plan
  from public.plans
  where plan_code = p_plan_code and is_active = true and plan_code <> 'free';

  if not found then
    raise exception 'Unknown or non-payable plan code: %', p_plan_code;
  end if;

  select * into v_subscription from public.subscriptions where user_id = v_user_id;

  -- Supported commercial paths only (AGENTS.md: Student, direct Pro,
  -- Student-upgraded-to-Pro — never Pro-to-Student). Rejecting attempt
  -- CREATION, not just activation, keeps the audit trail free of a
  -- downgrade the product must never honor, and matches the existing
  -- "reject early, never insert a doomed row" style used throughout this
  -- function.
  if p_plan_code = 'student' and v_subscription.plan_code = 'pro' and v_subscription.status = 'active' then
    raise exception 'Pro customers cannot purchase the Student plan.'
      using errcode = 'PT422', detail = 'PRO_CANNOT_DOWNGRADE_TO_STUDENT';
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

  -- Student-to-Pro upgrade quotation: both the credit and the destination
  -- Pro price come from the customer's LOCKED price version (see
  -- quote_student_to_pro_upgrade) — never the live active version, so a
  -- public price change can never move an in-period upgrade's price.
  if p_plan_code = 'pro' then
    select * into v_quote from public.quote_student_to_pro_upgrade(v_user_id);
    if found then
      v_is_upgrade := true;
      v_purchase_type := 'upgrade';
      v_source_plan_code := 'student';
      v_amount := v_quote.amount;
      v_credit := v_quote.credit_amount;
      v_price_version_id := v_quote.price_version_id;
      v_currency := v_quote.currency;
      v_billing_period := v_quote.billing_period;
    end if;
    -- No eligible upgrade quote (not an active in-period real-paid
    -- Student, or an already-Pro user): fall through to the ordinary
    -- active-version price below rather than inventing a discount.
  end if;

  -- Every other case (Free -> Student/Pro, an already-active same-plan
  -- renewal, an ineligible/lapsed Student requesting Pro) quotes from the
  -- currently active price version — this is also, deliberately, how a
  -- future renewal is priced: the then-current active price, never the
  -- customer's old locked version.
  if not v_is_upgrade then
    v_active_version := public.get_active_price_version();
    if v_active_version.id is null then
      raise exception 'No active price version is configured; cannot start checkout.'
        using errcode = 'PT500';
    end if;

    select * into v_plan_price
    from public.plan_prices
    where price_version_id = v_active_version.id and plan_code = p_plan_code;

    if not found then
      raise exception 'No price is configured for plan % under the active price version.', p_plan_code
        using errcode = 'PT500';
    end if;

    v_amount := v_plan_price.price_amount;
    v_currency := v_plan_price.currency;
    v_billing_period := v_plan_price.billing_period;
    v_price_version_id := v_active_version.id;
    v_purchase_type := case
      when v_subscription.plan_code = p_plan_code and v_subscription.status = 'active' then 'renewal'
      else 'initial'
    end;
  end if;

  -- Quota applies only from here on — a reused in-flight attempt above
  -- never reaches this check, so idempotent page refreshes are never
  -- affected by it. Unchanged from 20260822160000; an upgrade/renewal
  -- attempt consumes the same shared quota as any other new attempt.
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
    is_upgrade, credit_amount, price_version_id, purchase_type, source_plan_code, billing_period
  )
  values (
    v_user_id, v_plan.plan_code, v_amount, v_currency, 'whish', 'created', gen_random_uuid()::text,
    v_is_upgrade, v_credit, v_price_version_id, v_purchase_type, v_source_plan_code, v_billing_period
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.create_payment_attempt is
  'Canonical, sole entrypoint for starting a paid-plan checkout attempt — a fresh purchase (Free -> Student/Pro), a same-plan renewal, or a Student-to-Pro upgrade alike. Amount/currency/price_version_id always come from plan_prices (via get_active_price_version, or via quote_student_to_pro_upgrade''s locked version for an upgrade) — never from the caller. Rejects a Pro customer purchasing Student outright (no downgrade path exists). Idempotent: an in-flight created/pending attempt for the same plan_code is reused rather than duplicated (never quota-charged). Bounded by the existing payment_attempt_create quota (10/rolling hour/user).';

revoke execute on function public.create_payment_attempt(text) from public;
grant execute on function public.create_payment_attempt(text) to authenticated;

-- ── 6. activate_subscription / mark_payment_verified: lock + snapshot ────
-- activate_subscription gains a new trailing parameter. CREATE OR REPLACE
-- cannot append a parameter to an existing function in place (it creates
-- a second, ambiguously-named overload instead) — explicitly drop the old
-- 7-arg signature first so exactly one activate_subscription exists,
-- never two overloads (same "no ambiguous overloads" discipline as
-- save_job_preferences in 20260902090010_plan_aware_job_preferences.sql).
-- Not a PostgREST/client-facing concern (this function has never been
-- granted to authenticated/anon, service_role only) but still the single
-- source of truth internally.
drop function if exists public.activate_subscription(uuid, text, text, text, text, timestamptz, timestamptz);

create or replace function public.activate_subscription(
  p_user_id uuid,
  p_plan_code text,
  p_provider text,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_price_version_id uuid default null
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
    price_version_id = coalesce(p_price_version_id, price_version_id),
    activated_at = now()
  where user_id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'No subscription row exists for user %', p_user_id;
  end if;

  return v_row;
end;
$$;

comment on function public.activate_subscription is
  'Trusted server-only plan activation for Student, direct Pro, and Student-to-Pro upgrade alike. p_price_version_id locks subscriptions.price_version_id to the schedule the activating payment was actually priced from (coalesced against the existing value so a caller that omits it, none exist today, never clears a prior lock). service_role only.';

revoke execute on function public.activate_subscription(uuid, text, text, text, text, timestamptz, timestamptz, uuid) from public;
grant execute on function public.activate_subscription(uuid, text, text, text, text, timestamptz, timestamptz, uuid) to service_role;

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
  v_subscription public.subscriptions;
  v_period_start timestamptz;
  v_period_end timestamptz;
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

  -- Serializes this user's period-affecting verification: two concurrent
  -- mark_payment_verified calls for TWO DIFFERENT attempts of the same
  -- user (e.g. two early renewals racing) both read-then-write
  -- subscriptions.next_period_* — without this lock both could read the
  -- same pre-update snapshot and compute the SAME queued window instead
  -- of chaining. The FOR UPDATE above already serializes two calls for
  -- the SAME attempt id; this additionally serializes across different
  -- attempt ids for the same user. Mirrors the existing
  -- payment_attempt_create advisory lock in create_payment_attempt.
  perform pg_advisory_xact_lock(hashtext('mark_payment_verified:' || v_attempt.user_id::text)::bigint);

  -- Absorb any already-due queued period first, so "is this renewal
  -- early" is judged against the customer's TRUE current coverage, never
  -- a row left stale by an earlier early renewal.
  perform public.promote_due_subscription_period(v_attempt.user_id);

  select * into v_subscription from public.subscriptions where user_id = v_attempt.user_id;

  -- The billing period is derived server-side from purchase_type and the
  -- subscription's OWN current period, never trusted verbatim from the
  -- caller — p_period_start/p_period_end are used only for an 'initial'
  -- purchase (there is no prior period to derive from; a real payment
  -- provider's confirmation is the only source of truth there). This is
  -- what actually enforces, at the database layer, the invariants that
  -- previously depended only on whichever code calls this RPC getting it
  -- right: an upgrade must never move the period, and a renewal must
  -- begin exactly at the old period's end (never a gap, never an
  -- overlap, never computed from "now").
  if v_attempt.purchase_type = 'upgrade' then
    if v_subscription.current_period_start is null or v_subscription.current_period_end is null then
      raise exception 'Cannot verify an upgrade payment attempt %: user % has no existing billing period to preserve', p_payment_attempt_id, v_attempt.user_id
        using errcode = 'PT500';
    end if;
    -- Preserve exactly — AGENTS.md: "After payment succeeds, Pro access
    -- lasts until the original period end... Does not extend or reset
    -- the current period." Caller-supplied dates are ignored outright.
    v_period_start := v_subscription.current_period_start;
    v_period_end := v_subscription.current_period_end;
  elsif v_attempt.purchase_type = 'renewal' then
    if v_subscription.current_period_end is null then
      raise exception 'Cannot verify a renewal payment attempt %: user % has no existing billing period to renew from', p_payment_attempt_id, v_attempt.user_id
        using errcode = 'PT500';
    end if;
    if v_attempt.billing_period is distinct from 'monthly' then
      raise exception 'Unsupported billing_period % for a renewal payment attempt %', v_attempt.billing_period, p_payment_attempt_id
        using errcode = 'PT500';
    end if;

    if v_subscription.current_period_end > now() then
      -- EARLY renewal: the customer's existing period is still active
      -- right now. current_period_start/end must NOT be touched — doing
      -- so would prematurely discard time already paid for and
      -- misrepresent what period is actually in force. Queue this
      -- payment as the next period instead, chained onto any ALREADY-
      -- queued next period (so a second early renewal extends the queue
      -- rather than colliding with/overwriting it) rather than always
      -- deriving from current_period_end.
      v_period_start := coalesce(v_subscription.next_period_end, v_subscription.current_period_end);
      v_period_end := v_period_start + interval '1 month';

      update public.payment_attempts
      set status = 'paid',
          provider_payment_id = p_provider_payment_id,
          verified_at = now(),
          period_start = v_period_start,
          period_end = v_period_end
      where id = p_payment_attempt_id
      returning * into v_attempt;

      update public.subscriptions
      set next_period_start = v_period_start,
          next_period_end = v_period_end,
          next_price_version_id = v_attempt.price_version_id
      where user_id = v_attempt.user_id;

      -- Deliberately does NOT call activate_subscription: plan_code and
      -- status are already correct (this is a same-plan renewal of an
      -- already-active subscription), and current_period_start/end must
      -- stay exactly as they are until promote_due_subscription_period
      -- makes the queued period current.
      return v_attempt;
    end if;

    -- On-time or late: begins exactly where the current paid period
    -- ends — never earlier (would overlap/shorten what was already paid
    -- for), never later (would create a gap in paid access), and never
    -- derived from now() (a slow/delayed verification must not cost the
    -- customer time they already paid for). Length comes from the
    -- attempt's own locked billing_period, never a caller-supplied end
    -- date.
    v_period_start := v_subscription.current_period_end;
    v_period_end := v_period_start + interval '1 month';
  else
    v_period_start := p_period_start;
    v_period_end := p_period_end;
  end if;

  if v_period_start is null or v_period_end is null or v_period_end <= v_period_start then
    raise exception 'Invalid billing period for payment attempt % (start=%, end=%)', p_payment_attempt_id, v_period_start, v_period_end
      using errcode = 'PT500';
  end if;

  update public.payment_attempts
  set status = 'paid',
      provider_payment_id = p_provider_payment_id,
      verified_at = now(),
      period_start = v_period_start,
      period_end = v_period_end
  where id = p_payment_attempt_id
  returning * into v_attempt;

  perform public.activate_subscription(
    v_attempt.user_id,
    v_attempt.plan_code,
    v_attempt.provider,
    null,
    p_provider_payment_id,
    v_period_start,
    v_period_end,
    v_attempt.price_version_id
  );

  return v_attempt;
end;
$$;

comment on function public.mark_payment_verified is
  'Trusted server-only payment confirmation. The billing period is derived server-side from purchase_type, never trusted verbatim from p_period_start/p_period_end: an upgrade preserves the subscription''s existing current_period_start/end exactly (ignoring the caller''s dates outright); an ON-TIME OR LATE renewal begins exactly at the existing current_period_end and runs for the attempt''s own locked billing_period; an EARLY renewal (current_period_end still in the future) never touches current_period_start/end at all — it queues the paid period onto subscriptions.next_period_start/end instead (chained onto any already-queued next period), promoted into the current period only once it is actually due (promote_due_subscription_period, called opportunistically from here and from create_payment_attempt, and mirrored read-only in get_onboarding_readiness). Only an initial purchase (no prior period exists) uses the caller-supplied dates, since a real payment provider''s confirmation is the only source of truth there. Stamps the resulting period onto the payment_attempts row itself as an immutable purchase-level record. Idempotent: re-verifying an already-paid attempt returns it unchanged rather than re-activating; a pg_advisory_xact_lock per user additionally serializes concurrent verifications of DIFFERENT attempts for the same user so queued-period chaining can never race. service_role only.';

-- ── 7. get_onboarding_readiness: read-only early-renewal correctness ─────
-- Redefines the function from 20260902090010_plan_aware_job_preferences.sql
-- (that migration is left untouched — this is the codebase's existing
-- convention for superseding a function body in a later migration, not a
-- rewrite of history). Only plan_eligible's period check changes: it must
-- account for an EARLY renewal that hasn't been physically promoted yet
-- (see promote_due_subscription_period above) — this function is STABLE
-- and therefore cannot write, so it computes the same "is the queued
-- period actually due" logic read-only instead. Without this, a plain
-- read (e.g. a dashboard load with no payment action in between) in the
-- gap between current_period_end elapsing and the next payment-related
-- RPC call would see the stale current_period_end and incorrectly report
-- the subscription as no longer active, even though next_period_end
-- covers it.
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
  v_effective_period_end timestamptz;
  v_cv_storage_object_exists boolean := false;
  v_plan_eligible boolean := false;
  v_preferences_complete boolean := false;
  v_has_active_task boolean := false;
  v_has_target_role boolean := false;
  v_has_location boolean := false;
  v_has_relocation_location boolean := false;
  v_has_authorized_country boolean := false;
  v_international_complete boolean := false;
  v_next_step text;
begin
  if v_user_id is null then
    return jsonb_build_object('authenticated', false, 'next_step', 'login');
  end if;

  select * into v_profile from public.profiles where id = v_user_id;
  select * into v_cv from public.cvs where user_id = v_user_id and is_active = true;
  select * into v_prefs from public.job_preferences where user_id = v_user_id;
  select * into v_subscription from public.subscriptions where user_id = v_user_id;

  if v_cv.storage_path is not null then
    select exists(
      select 1 from storage.objects
      where bucket_id = 'cvs' and name = v_cv.storage_path
    ) into v_cv_storage_object_exists;
  end if;

  -- Read-only mirror of promote_due_subscription_period's "is it due"
  -- condition: if current_period_end has already passed AND a next
  -- period is queued, that queued period's end is the TRUE boundary,
  -- regardless of whether the physical row has been promoted yet.
  v_effective_period_end := case
    when v_subscription.current_period_end is not null
         and v_subscription.next_period_end is not null
         and now() >= v_subscription.current_period_end
    then v_subscription.next_period_end
    else v_subscription.current_period_end
  end;

  if v_subscription.status = 'active'
     and (v_effective_period_end is null or v_effective_period_end > now())
  then
    v_plan_eligible := true;
  end if;

  if v_prefs.id is not null then
    select exists(
      select 1 from public.job_preference_target_roles where job_preference_id = v_prefs.id
    ) or coalesce(array_length(v_prefs.custom_target_roles, 1), 0) > 0
    into v_has_target_role;

    select exists(
      select 1 from public.job_preference_locations where job_preference_id = v_prefs.id
    ) or coalesce(array_length(v_prefs.custom_locations, 1), 0) > 0
    into v_has_location;

    select exists(
      select 1 from public.job_preference_relocation_locations where job_preference_id = v_prefs.id
    ) into v_has_relocation_location;

    select exists(
      select 1 from public.job_preference_authorized_countries where job_preference_id = v_prefs.id
    ) into v_has_authorized_country;
  end if;

  -- country_of_residence is no longer part of preferences completeness —
  -- it is a system-level Lebanon constant, defaulted automatically (see
  -- handle_new_user), never collected from the user.
  v_preferences_complete := v_prefs.work_arrangement is not null
    and v_prefs.job_type is not null
    and v_prefs.experience_level is not null
    and v_prefs.lebanon_location_scope is not null
    and (v_profile.university_id is not null or v_profile.custom_university is not null)
    and (v_profile.major_id is not null or v_profile.custom_major is not null)
    and v_has_target_role
    and (v_prefs.work_arrangement not in ('onsite', 'hybrid', 'flexible') or v_has_location);

  -- International readiness is intentionally separate from Lebanon
  -- readiness (AGENTS.md: "do not use one ambiguous boolean"). Disabled
  -- international search is a complete, valid state on its own.
  if v_prefs.id is null or v_prefs.international_search_enabled is not true then
    v_international_complete := not coalesce(v_prefs.international_search_enabled, false);
  elsif v_prefs.willing_to_relocate is null then
    v_international_complete := false;
  elsif v_prefs.willing_to_relocate is false then
    v_international_complete := true;
  else
    v_international_complete :=
      v_has_relocation_location
      and v_prefs.work_authorization_status is not null
      and (v_prefs.work_authorization_status <> 'already_authorized' or v_has_authorized_country);
  end if;

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
    'next_step', v_next_step,
    'international_search_enabled', coalesce(v_prefs.international_search_enabled, false),
    'international_preferences_complete', v_international_complete
  );
end;
$$;

comment on function public.get_onboarding_readiness is
  'Trusted, auth.uid()-scoped onboarding readiness. preferences_complete no longer requires country_of_residence (system-level Lebanon constant, see handle_new_user) and now requires lebanon_location_scope. plan_eligible uses an effective period end that accounts for a queued-but-not-yet-physically-promoted early renewal (subscriptions.next_period_end) — see promote_due_subscription_period — so a plain read between period-elapse and the next payment-related call never incorrectly reports an early-renewed subscription as inactive. international_preferences_complete is a SEPARATE gate — disabled international search is complete on its own; only an enabled-but-incomplete configuration (missing relocation location, authorization status, or authorized country) is incomplete. Actual matching eligibility additionally requires is_cv_analysis_matching_eligible(), unchanged by this migration.';
