-- Public plan catalog + protected price-publishing operation.
--
-- This migration does NOT change any price. Student stays $9.00/month,
-- Pro stays $18.00/month (public.plans.price_amount, public.plan_prices
-- under the 'launch-2026-08' price_versions row — both unchanged).
--
-- Problem this closes: src/components/landing/Pricing.tsx still hard-codes
-- "$9"/"$18"/"$29" as frontend string constants (a second, competing
-- source of truth for money, even though it happens to agree with the
-- database today) and there is no safe way for an unauthenticated visitor
-- to read the real catalog at all — public.plans/price_versions/plan_prices
-- grant `select` to `authenticated` only. A future price change today
-- would require editing a migration/table row AND a React component AND
-- trusting nobody forgets the second edit.
--
-- Two additive objects:
--   1. get_public_plan_catalog() — the one safe read path for the current
--      public catalog (active plans, active price version only). SECURITY
--      DEFINER, justified below, so it works for anonymous landing-page
--      visitors WITHOUT granting anon any direct table access to
--      price_versions/plan_prices (which would otherwise expose every
--      historical/inactive schedule via a plain `using (true)` policy —
--      exactly what this migration must NOT expose).
--   2. publish_price_version(p_label, p_prices) — the one protected
--      operation for activating a new price schedule. service_role only.
--      Validates every plan code/amount/currency/billing_period, requires
--      a price for every currently-active plan (not just paid ones — see
--      its own comment), rejects duplicates, is fully transactional (any
--      failure rolls back the whole thing — this is one PL/pgSQL function
--      body, there is no partial-commit path), serializes concurrent
--      publish attempts with an advisory lock, keeps exactly one active
--      price_versions row (already guaranteed by the existing
--      price_versions_one_active_idx partial unique index from
--      20260903090000), optionally syncs the legacy public.plans display
--      columns (documented as required by that same migration's comment
--      on public.plans.price_amount), and writes one audit_events row.
--
-- Existing guarantees from 20260903090000 are untouched and still hold:
-- create_payment_attempt/mark_payment_verified/quote_student_to_pro_upgrade
-- are not modified by this migration; a locked subscriptions.price_version_id
-- / payment_attempts.price_version_id is never affected by activating a
-- new price_versions row (see that migration for why).

-- ── 1. get_public_plan_catalog() ──────────────────────────────────────────
--
-- Why SECURITY DEFINER instead of SECURITY INVOKER here specifically: an
-- invoker-rights version would require granting `anon` direct `select` on
-- public.plans/public.price_versions/public.plan_prices so the function's
-- own query succeeds under the caller's RLS. Every one of those tables'
-- existing select policies is `using (true)` with NO is_active filter —
-- granting `anon` that same policy would let an anonymous visitor query
-- public.plan_prices directly and read every historical and inactive price
-- schedule ever published, not just the current one. A definer-rights
-- function avoids widening any table grant at all: it returns only the
-- specific, filtered, already-safe columns computed below, and `anon`/
-- `authenticated` never gain row-level access to the underlying tables.
-- This is the smaller privilege footprint of the two options, even though
-- "definer" sounds like more privilege than "invoker" — the actual
-- data-exposure surface is smaller. Hardening applied: fixed empty
-- search_path, every reference schema-qualified, no dynamic SQL, no
-- parameters at all (nothing client-suppliable to misuse), STABLE (no
-- writes possible), EXECUTE revoked from PUBLIC before being granted only
-- to anon/authenticated/service_role (the last so the publish/verification
-- path below can read its own effect back, same convention as
-- get_active_price_version in 20260903090000).
create or replace function public.get_public_plan_catalog()
returns table (
  plan_code text,
  display_name text,
  price_amount numeric,
  currency text,
  billing_period text,
  job_match_limit integer,
  cover_letter_limit integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.plan_code,
    p.display_name,
    pp.price_amount,
    pp.currency,
    pp.billing_period,
    p.job_match_limit,
    p.cover_letter_limit
  from public.plans p
  join public.plan_prices pp
    on pp.plan_code = p.plan_code
   and pp.price_version_id = (
     select pv.id from public.price_versions pv where pv.is_active = true limit 1
   )
  where p.is_active = true
  order by pp.price_amount asc;
$$;

comment on function public.get_public_plan_catalog is
  'The single safe, public read path for "what can be purchased right now, for how much" — active plans only, priced from the single active price_versions row only. Returns zero rows (not an error) if no price version is currently active (a misconfiguration state a caller must treat as "pricing unavailable", never as "free"). Exposes only display-safe columns — no payment IDs, no user data, no historical/inactive price schedules, no internal price_version id. SECURITY DEFINER is a deliberate least-exposure choice, justified above; callers never gain direct table access as a side effect of being able to call this function. Safe to call from the unauthenticated landing page and from authenticated pages alike.';

revoke execute on function public.get_public_plan_catalog() from public;
grant execute on function public.get_public_plan_catalog() to anon;
grant execute on function public.get_public_plan_catalog() to authenticated;
-- Also needed by service_role: publish_price_version's own tests/operational
-- verification read the catalog back after publishing (same pattern as
-- get_active_price_version, which grants service_role alongside
-- authenticated in 20260903090000).
grant execute on function public.get_public_plan_catalog() to service_role;

-- ── 2. publish_price_version(): the one protected price-change operation ─
--
-- service_role only — never granted to authenticated/anon. There is no
-- admin-UI code path in this repository that would call this (none is
-- built in this migration, per the task that introduced it); it is invoked
-- directly with the service-role key (e.g. via the Supabase SQL editor,
-- a one-off trusted script, or a future admin route built with
-- src/lib/authz/requireAdmin.ts + a server-only service-role client) — see
-- docs/PRICING.md for a safe invocation example. Never exposed to an
-- ordinary authenticated user's session under any circumstance.
create or replace function public.publish_price_version(
  p_label text,
  p_prices jsonb
)
returns public.price_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_version public.price_versions;
  v_item jsonb;
  v_plan_code text;
  v_price_amount numeric;
  v_currency text;
  v_billing_period text;
  v_seen_codes text[] := '{}';
  v_required_codes text[];
  v_missing text[];
begin
  -- Serializes concurrent publish attempts end to end (item 15: "safe
  -- under two concurrent publication attempts"). A fixed, hard-coded lock
  -- key is intentional — there is only ever one "publish a price version"
  -- operation in this whole system, so a single global key is correct
  -- (contrast with create_payment_attempt's per-user key, which needs one
  -- lock per user, not one lock total). Released automatically at
  -- transaction end.
  perform pg_advisory_xact_lock(hashtext('publish_price_version'));

  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'A non-empty label is required to publish a price version.'
      using errcode = 'PT400';
  end if;

  if p_prices is null or jsonb_typeof(p_prices) is distinct from 'array' or jsonb_array_length(p_prices) = 0 then
    raise exception 'p_prices must be a non-empty JSON array of {plan_code, price_amount, currency, billing_period}.'
      using errcode = 'PT400';
  end if;

  -- Validate every entry before writing anything. Any exception raised
  -- anywhere in this function aborts the whole transaction (this is one
  -- PL/pgSQL function body — there is no way to commit a partial result),
  -- satisfying "prevent a half-published price schedule" (item 14) and
  -- "roll back the complete transaction if any part fails" (item 10)
  -- together, by construction.
  for v_item in select * from jsonb_array_elements(p_prices)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'Each entry in p_prices must be a JSON object.'
        using errcode = 'PT400';
    end if;

    v_plan_code := v_item ->> 'plan_code';
    v_currency := coalesce(v_item ->> 'currency', 'USD');
    v_billing_period := v_item ->> 'billing_period';

    begin
      v_price_amount := (v_item ->> 'price_amount')::numeric;
    exception when others then
      raise exception 'price_amount for plan % is not a valid decimal number.', coalesce(v_plan_code, '(missing)')
        using errcode = 'PT400';
    end;

    if v_plan_code is null or length(trim(v_plan_code)) = 0 then
      raise exception 'Every entry in p_prices must include a non-empty plan_code.'
        using errcode = 'PT400';
    end if;

    if not exists (select 1 from public.plans where plan_code = v_plan_code) then
      raise exception 'Unknown plan code: %. A price version can only price plan codes that already exist in public.plans.', v_plan_code
        using errcode = 'PT400';
    end if;

    if v_plan_code = any (v_seen_codes) then
      raise exception 'Duplicate plan code in price schedule: %', v_plan_code
        using errcode = 'PT400';
    end if;

    if v_price_amount is null or v_price_amount < 0 then
      raise exception 'Invalid price_amount for plan %: must be a non-negative decimal.', v_plan_code
        using errcode = 'PT400';
    end if;

    if v_currency is null or length(v_currency) <> 3 then
      raise exception 'Invalid currency for plan %: must be a 3-letter ISO 4217 code (e.g. USD).', v_plan_code
        using errcode = 'PT400';
    end if;

    if v_billing_period is null or v_billing_period not in ('forever', 'monthly') then
      raise exception 'Invalid billing_period for plan %: must be forever or monthly.', v_plan_code
        using errcode = 'PT400';
    end if;

    v_seen_codes := array_append(v_seen_codes, v_plan_code);
  end loop;

  -- Required coverage: every plan public.get_public_plan_catalog() would
  -- currently show (is_active = true), not merely the paid ones. This is
  -- deliberately broader than "all paid plans" alone: get_public_plan_catalog
  -- inner-joins plans to plan_prices under the active version, so a plan
  -- missing from the NEW version's prices would silently vanish from the
  -- public catalog the moment this version activates — including Free,
  -- which must always be priced (normally 0.00/forever) in every version
  -- for the catalog to keep showing it. Sourced from public.plans itself,
  -- not hard-coded, so this stays correct if a plan is added or retired
  -- later without needing to edit this function.
  select array_agg(plan_code) into v_required_codes
  from public.plans
  where is_active = true;

  select array_agg(code) into v_missing
  from unnest(coalesce(v_required_codes, '{}'::text[])) as code
  where not (code = any (v_seen_codes));

  if v_missing is not null then
    raise exception 'Price schedule is missing required active plan(s): %. Every currently active plan must be priced in every published version.', array_to_string(v_missing, ', ')
      using errcode = 'PT400';
  end if;

  -- Create the new version inactive first — it only becomes the checkout-
  -- authoritative schedule once fully populated and explicitly activated
  -- below, never partially.
  insert into public.price_versions (label, is_active)
  values (p_label, false)
  returning * into v_new_version;

  insert into public.plan_prices (price_version_id, plan_code, price_amount, currency, billing_period)
  select
    v_new_version.id,
    item ->> 'plan_code',
    (item ->> 'price_amount')::numeric,
    coalesce(item ->> 'currency', 'USD'),
    item ->> 'billing_period'
  from jsonb_array_elements(p_prices) as item;

  -- Exactly one active version, atomically: deactivate whatever is
  -- currently active, then activate the new one. price_versions_one_active_idx
  -- (the partial unique index from 20260903090000) additionally makes it
  -- structurally impossible for two rows to ever be active at once, even
  -- if this ordering were somehow violated.
  update public.price_versions set is_active = false where is_active = true;
  update public.price_versions set is_active = true where id = v_new_version.id
  returning * into v_new_version;

  -- Optional legacy-display sync (item 11): public.plans.price_amount/
  -- currency/billing_period is documented (20260903090000, comment on
  -- public.plans.price_amount) as a display-only mirror that "must be kept
  -- in sync by hand whenever a new price version is activated" — this is
  -- exactly the manual, error-prone step this whole migration exists to
  -- remove. Synced here, atomically, in the same transaction, so it can
  -- never drift from what was actually just published.
  update public.plans p
  set price_amount = pp.price_amount,
      currency = pp.currency,
      billing_period = pp.billing_period
  from public.plan_prices pp
  where pp.price_version_id = v_new_version.id
    and pp.plan_code = p.plan_code;

  -- Safe operational metadata only (AGENTS.md §19) — plan codes and the
  -- new version's id/label, never anything else. No CV/user content is
  -- reachable from this function at all.
  insert into public.audit_events (user_id, actor_type, event_type, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when auth.uid() is null then 'system' else 'admin' end,
    'price_version_published',
    'price_versions',
    v_new_version.id,
    jsonb_build_object('label', p_label, 'plan_codes', to_jsonb(v_seen_codes))
  );

  return v_new_version;
end;
$$;

comment on function public.publish_price_version is
  'The single protected operation for publishing a new price schedule and making it checkout-authoritative. service_role only — never grant to authenticated/anon. Validates plan codes against public.plans, positive decimal amounts, 3-letter currency codes, forever/monthly billing_period, and rejects duplicate plan codes within one call. Requires a price for every currently active plan (not just paid ones — see the function body for why Free must be included too). Fully transactional: any validation failure raises before any row is written, and the whole call is one PL/pgSQL function body, so there is no partial-publish state ever observable by another session. Serialized end to end with a fixed advisory lock, so two concurrent publish calls can never both partially apply or race the "exactly one active version" invariant. Never rebills or relocates any existing subscriptions/payment_attempts row (both stay locked to their own already-referenced price_version_id, per 20260903090000) — publishing a new version only changes what a FUTURE fresh purchase/renewal/upgrade quotes from. Writes one audit_events row (price_version_published). See docs/PRICING.md for a safe invocation example.';

revoke execute on function public.publish_price_version(text, jsonb) from public;
grant execute on function public.publish_price_version(text, jsonb) to service_role;

-- ── 3. audit_events.event_type: additive widening for the new action ─────
alter table public.audit_events
  drop constraint audit_events_event_type_check;

alter table public.audit_events
  add constraint audit_events_event_type_check
  check (event_type in (
    'cv_analysis_confirmed', 'cover_letter_approved', 'match_approved', 'match_rejected',
    'application_approved', 'application_send_attempted', 'application_send_result',
    'admin_job_created', 'admin_job_updated', 'admin_job_deleted', 'account_data_deleted',
    'price_version_published'
  ));
