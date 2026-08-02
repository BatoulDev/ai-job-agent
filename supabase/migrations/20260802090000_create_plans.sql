-- plans: canonical, trusted source of truth for pricing and feature limits.
--
-- This table (not the browser, and not any single frontend component) is
-- what server-side entitlement checks must read. The values below are
-- copied exactly from the approved marketing copy in
-- src/components/landing/Pricing.tsx at the time of writing — see that
-- file's comment pointing back here. If pricing ever changes, update the
-- row here first (a reviewed migration), then update the marketing copy to
-- match; never the other way around.
--
-- Stable plan codes ('free', 'student', 'pro') are referenced by
-- subscriptions.plan_code and payment_attempts.plan_code and must never be
-- reused for a different plan or renamed once shipped.
create table public.plans (
  plan_code text primary key,
  display_name text not null,
  price_amount numeric(10, 2) not null check (price_amount >= 0),
  currency text not null default 'USD',
  billing_period text not null check (billing_period in ('forever', 'monthly')),
  is_active boolean not null default true,
  job_match_limit integer not null check (job_match_limit >= 0),
  cover_letter_limit integer not null check (cover_letter_limit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.plans is
  'Canonical plan catalog. Modified only through reviewed migrations, never by application code. Server-side entitlement checks and payment-amount lookups must read this table, never trust a browser-supplied price or limit.';

alter table public.plans enable row level security;

create trigger set_plans_updated_at
  before update on public.plans
  for each row
  execute function public.set_updated_at();

-- Authenticated users may read the catalog (e.g. to show "your plan"
-- details on the dashboard later). No insert/update/delete policy exists
-- for any client role — this table is system-managed only.
create policy "plans_select_authenticated"
  on public.plans
  for select
  to authenticated
  using (true);

grant select on public.plans to authenticated;

-- Seed the three approved plans. Matches AGENTS.md / Pricing.tsx exactly:
-- Free: 1 job match + 1 cover letter per month, no cost.
-- Student: 25 job matches + 8 cover letters per month, $9/month launch price.
-- Pro: 45 job matches + 15 cover letters per month, $18/month launch price.
insert into public.plans
  (plan_code, display_name, price_amount, currency, billing_period, is_active, job_match_limit, cover_letter_limit)
values
  ('free', 'Free', 0.00, 'USD', 'forever', true, 1, 1),
  ('student', 'Student', 9.00, 'USD', 'monthly', true, 25, 8),
  ('pro', 'Pro', 18.00, 'USD', 'monthly', true, 45, 15)
on conflict (plan_code) do nothing;
