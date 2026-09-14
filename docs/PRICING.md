# Pricing — Source of Truth, Checkout Flow, and How to Change a Price

**Status:** current as of `supabase/migrations/20260914100000_add_public_plan_catalog_and_price_publishing.sql`.
No price changed in that migration or in this document — Student is still $9.00/month, Pro is still $18.00/month.

## 1. What's authoritative

| Question | Authoritative source |
|---|---|
| What plans exist, their codes, feature limits, `is_active` | `public.plans` |
| What a plan actually **costs right now** | `public.plan_prices`, joined to the single active `public.price_versions` row |
| What a specific past purchase/renewal/upgrade actually charged | `payment_attempts.amount` / `payment_attempts.price_version_id` (locked at creation, never recomputed) |
| Which price schedule a subscription is billed under | `subscriptions.price_version_id` (locked at purchase, changes only on a genuine renewal/upgrade transaction) |
| What the public landing page shows | `public.get_public_plan_catalog()` — reads `plans` + the active `plan_prices` row server-side, nothing else |

`public.plans.price_amount/currency/billing_period` still exists but is **display-only legacy state**, kept in sync by `publish_price_version()` (Section 4) purely so nothing reads a stale value from that column by accident. No checkout, upgrade, or renewal logic has ever read `plans.price_amount` for money — `plan_prices` has been checkout-authoritative since `20260903090000`.

The frontend (`src/components/landing/Pricing.tsx`) holds **zero** price/currency/billing-period values. It holds only presentation content (names, feature bullet lists, CTA labels, launch-discount "original price" marketing copy) keyed by stable `plan_code`, and renders the real number it gets back from `get_public_plan_catalog()` at request time.

## 2. Why the frontend is never authoritative

A frontend price constant is a second, independently-maintainable copy of a number that also has to be right in the database — the two *will* eventually disagree (a code deploy misses a migration, or vice versa), and whichever one the checkout API trusts is the one that matters for money. This repo trusts exactly one: the database. The browser may only ever say *which* plan it wants (`{ "planCode": "pro" }`); every dollar amount, currency, and price-version id is derived server-side, in Postgres, from `plan_prices` under the currently active `price_versions` row.

## 3. How checkout resolves a price

`POST /api/checkout` (`src/app/api/checkout/route.ts`):

1. `parseCheckoutRequestBody()` (`src/app/api/checkout/parseCheckoutRequest.ts`) enforces a **strict single-key allowlist**: the request body must be exactly `{ "planCode": "student" | "pro" }`. Any other key present — `amount`, `currency`, `priceVersionId`, `isAdmin`, anything — is rejected outright (400), not silently dropped. Unit-tested in `tests/unit/checkout-request-tampering.test.mjs`.
2. `startCheckout(planCode)` (`src/lib/payments/checkout.ts`) authenticates the caller server-side (`supabase.auth.getUser()`) and calls `public.create_payment_attempt(p_plan_code)` — a Postgres RPC with **exactly one parameter**. There is no argument name a caller could add, even bypassing the Next.js route entirely and calling the REST endpoint directly with a stolen anon key — PostgREST rejects any extra parameter outright. Proven empirically (not re-implemented in JS) in `tests/db/checkout-tampering.test.mjs`.
3. `create_payment_attempt` resolves the active price version (`get_active_price_version()`), reads the plan's amount/currency/billing_period from `plan_prices` for that version, classifies `purchase_type` (initial/renewal/upgrade), and writes the resulting `payment_attempts` row with the server-derived amount and `price_version_id`. The client never supplies, and cannot influence, any of these values.
4. The route returns only what the next checkout step needs (`paymentAttempt`, `whishConfigured`) — never anything that would let a client override step 3's result on a follow-up call.

## 4. How to publish a future price version

Use `public.publish_price_version(p_label text, p_prices jsonb)` — **service_role only**, never exposed to `authenticated`/`anon`, and there is no admin UI calling it in this repo. Invoke it directly with the service-role key (Supabase SQL editor, or a trusted one-off script) once official pricing is decided:

```sql
select public.publish_price_version(
  'launch-2026-11',                     -- p_label: any non-empty human label
  '[
    {"plan_code": "free",    "price_amount": 0,     "currency": "USD", "billing_period": "forever"},
    {"plan_code": "student", "price_amount": 9.00,  "currency": "USD", "billing_period": "monthly"},
    {"plan_code": "pro",     "price_amount": 22.00, "currency": "USD", "billing_period": "monthly"}
  ]'::jsonb
);
```

Rules enforced by the function itself (all-or-nothing — any violation aborts the whole call, nothing is written):

- Every currently `is_active` plan in `public.plans` must be priced — **including Free** (omitting it would silently drop Free from the public catalog the moment this version activates).
- No unknown plan codes, no duplicates within one call.
- `price_amount` must be a non-negative decimal; `currency` must be a 3-letter code; `billing_period` must be `forever` or `monthly`.
- The new version is inserted inactive, fully populated, then atomically swapped to active while the previous version is deactivated in the same transaction — a concurrent reader never sees a half-published schedule, and two concurrent `publish_price_version` calls are serialized by a fixed advisory lock (`tests/db/publish-price-version.test.mjs` proves this under real concurrency).
- `public.plans.price_amount/currency/billing_period` (the legacy display mirror) is synced atomically in the same transaction.
- One `audit_events` row (`price_version_published`) is written — plan codes and the new version's id/label only, never anything sensitive.

That single call is the entire price-change procedure. No React component, no other SQL file, no checkout/upgrade code needs to change.

## 5. What happens to existing subscriptions and payments

Nothing. `subscriptions.price_version_id` and `payment_attempts.price_version_id` are set once, at purchase/renewal/upgrade time, and are never touched by `publish_price_version` or by any later price change — see `20260903090000` for the full locking design and `tests/db/price-versioning-and-upgrade.test.mjs` for its existing regression coverage, both unmodified by this work.

## 6. What happens at renewal

An early renewal (paid before the current period ends) never modifies the active period — the newly-paid period is queued onto `subscriptions.next_period_*` and only physically promoted once actually due (`promote_due_subscription_period()`, called opportunistically by `create_payment_attempt` and `mark_payment_verified`, since this project has no cron). A renewal always quotes from whatever price version is active *at renewal time* — a public price change between purchases is expected to affect the next renewal, just never the period already paid for.

## 7. What happens during a Student-to-Pro upgrade

`quote_student_to_pro_upgrade()` sources **both** the Student credit and the destination Pro price from the customer's own **locked** `subscriptions.price_version_id` — never the live active version. A public price change between the customer's original purchase and their upgrade cannot mis-price the upgrade in either direction.

## 8. How to verify the public catalog

```sql
select * from public.get_public_plan_catalog();
```

Works for `anon` and `authenticated` (and `service_role`, needed so a price-publish operation can immediately verify its own effect). Returns only `plan_code, display_name, price_amount, currency, billing_period, job_match_limit, cover_letter_limit` for `is_active` plans, priced from the single active `price_versions` row — never a historical/inactive schedule, never an internal id, never payment or user data. `SECURITY DEFINER` with a fixed empty `search_path` and every reference schema-qualified (see the migration's own comment for why definer-rights is the *smaller* privilege footprint here, not the larger one).

## 9. How to run pricing security tests

```bash
npm run test:unit   # tests/unit/checkout-request-tampering.test.mjs, tests/unit/pricing-catalog-fail-closed.test.mjs
npm run test:db     # tests/db/public-plan-catalog.test.mjs, tests/db/checkout-tampering.test.mjs, tests/db/publish-price-version.test.mjs, tests/db/price-versioning-and-upgrade.test.mjs
```

`test:db` requires local Supabase running (`npx supabase status`) with all migrations applied (`npx supabase migration list --local`).

## 10. Credentials/role required for a price change

`service_role` only. `publish_price_version` has no `authenticated`/`anon` grant and no admin-UI code path exists in this repository — a price change today is a deliberate, out-of-band, service-role SQL call, not a self-service action from any signed-in session including an admin one. Building an admin UI around this function later is safe (it re-validates everything itself) but is out of scope here.
