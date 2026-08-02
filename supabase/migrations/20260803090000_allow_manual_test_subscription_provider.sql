-- Adds 'manual_test' as an allowed subscriptions.provider value, so a
-- paid plan (student/pro) can be represented as a local development test
-- entitlement WITHOUT claiming it was verified by Whish. This is the
-- smallest schema change that lets a local seed fixture grant Karim/Lina
-- test accounts a Student/Pro entitlement while staying unmistakably
-- distinguishable from a real, provider-verified payment.
--
-- Trust boundary is unchanged: 'manual_test' can only ever be written
-- through the existing activate_subscription() function (see
-- 20260802090010_create_subscriptions.sql), whose EXECUTE grant is still
-- service_role only. A normal authenticated user still cannot set their
-- own provider to 'whish' OR 'manual_test' — there is still no
-- update policy on public.subscriptions for the authenticated role.
alter table public.subscriptions
  drop constraint subscriptions_provider_check;

alter table public.subscriptions
  add constraint subscriptions_provider_check
  check (provider in ('free', 'whish', 'manual_test'));

alter table public.subscriptions
  drop constraint subscriptions_provider_matches_plan;

alter table public.subscriptions
  add constraint subscriptions_provider_matches_plan
  check (
    (plan_code = 'free' and provider = 'free')
    or (plan_code <> 'free' and provider in ('whish', 'manual_test'))
  );

comment on constraint subscriptions_provider_matches_plan on public.subscriptions is
  'manual_test is for local development seed fixtures only (see scripts/seed-local-automation-users.mjs) — it must never represent a real payment. payment_attempts.provider is intentionally NOT extended: a manual_test subscription has no associated payment_attempts row at all, since no payment occurred.';
