# Lebanon + Gulf Plan/Product Consistency Audit (Phase 18)

Branch: `phase/18-plan-coverage-consistency`, forked from `phase/17-
ingestion-adversarial-hardening` @ `4fa4f71`. Goal: verify backend and
frontend agree on the final plan geography (Student: Lebanon; Pro:
Lebanon + Gulf relocation + international remote). No pricing changed, no
entitlement rule changed — audit and regression tests only, per this
phase's explicit mandate.

**Bottom line, stated up front**: the system is **largely consistent**.
One real, concrete gap was found — `job_market_coverage`'s `remote_mena`/
`remote_worldwide` tiers are fully built and tested on the backend but
**unreachable from any UI today** — documented and regression-tested
below, not fixed (a UI addition is a real feature, outside this audit's
scope). No false marketing promise was found: the one plan-geography claim
that *could* have been overstated (Pro's "verified international remote
roles") is not, because what it actually delivers matches what it says.

---

## 1. What was audited, and how

Read/traced end-to-end, not assumed: `src/components/landing/Pricing.tsx`
(marketing copy), `src/app/onboarding/preferences/page.tsx` (the only
place preferences are set — no separate settings-page duplicate),
`src/components/dashboard/InternationalPreferencesReminderBanner.tsx` and
`PreferencesSection.tsx` (dashboard copy), `src/lib/ingestion/
checkJobEligibility.ts` (the real hard-eligibility gate, unmodified),
`supabase/migrations/20260902090010_plan_aware_job_preferences.sql` (the
`save_job_preferences` RPC backend), and the real `locations` table
(relocation-market catalog) queried directly against local Postgres.

---

## 2. Real finding: Student CAN see some international-remote jobs — and this is correct, not a bug

Phase 17 flagged this as worth investigating (§7 of
`docs/LEBANON_GULF_INGESTION_VALIDATION.md`). Traced to source this phase:

`checkJobEligibility()`'s `remoteScopeIncludesLebanon()` helper makes a
`worldwide`- or `region:mena`-scoped remote job eligible for **every**
plan, not just Pro — by design, per the function's own existing comment:
*"Lebanon is itself MENA, so a MENA-scoped or worldwide remote job always
includes Lebanon-based applicants."*

**This matches the real, actual marketing copy exactly.** `Pricing.tsx`'s
Student feature list says *"Best for students and fresh graduates
targeting **Lebanon-based or Lebanon-friendly** roles"* — not
"Lebanon-only." A worldwide-remote job a Lebanon-based person can actually
do without relocating **is** a Lebanon-friendly role under any reasonable
reading of that phrase. Pro's own copy, *"Verified international remote
roles that accept Lebanon-based applicants,"* describes exactly the same
Lebanon-inclusive-scope jobs — confirmed by reading the actual onboarding
UI copy shown to a Pro user turning the toggle on: *"We'll search verified
international remote roles that accept applicants based in Lebanon."*

**Conclusion: not a bug, not a mismatch.** No code or copy was changed.

---

## 3. Real finding: `job_market_coverage`'s wider tiers are backend-complete but frontend-unreachable

Tracing *why* a Pro user's "international search" toggle doesn't actually
unlock the `remote_mena`/`remote_worldwide` tiers led to the real, concrete
gap this phase's audit exists to catch:

- `save_job_preferences` (the RPC every preference save calls) fully
  accepts `p_job_market_coverage` as a real parameter, and
  `checkJobEligibility.ts`'s own existing test suite
  (`tests/unit/check-job-eligibility.test.mjs`) proves all four tiers
  (`lebanon_only`, `remote_lebanon_applicants`, `remote_mena`,
  `remote_worldwide`) work correctly in isolation.
- **`src/app/onboarding/preferences/page.tsx` — the only place any user,
  on any plan, can set preferences — hardcodes `p_job_market_coverage:
  null` on every single save**, regardless of plan or any toggle state.
  No other UI in this codebase (dashboard, settings) offers a second path
  to set it.
- Consequence, proven directly this phase against the real, unmodified
  `checkJobEligibility()`: a Pro user with "international search" **ON**
  gets `coverage = jobMarketCoverage ?? "remote_lebanon_applicants"` →
  always `"remote_lebanon_applicants"` → a genuinely non-Lebanon-scoped
  remote job (e.g. "Remote — US only") is **still ineligible**, identically
  to a Free user. The toggle currently changes nothing about which remote
  jobs a Pro user sees beyond what §2 already gives everyone for free.

**What the toggle *does* still deliver, confirmed working**: Gulf
relocation eligibility (onsite/hybrid jobs in Saudi Arabia/Qatar/Kuwait/
UAE) — a real, working, genuinely Pro-exclusive differentiator, gated
correctly on `planCode==='pro' && internationalSearchEnabled &&
willingToRelocate && relocationMarketCountryCodes.includes(...)`, verified
directly in Phase 17 §7B against a real Gulf job.

**Not fixed this phase** — building a `job_market_coverage` picker is a
real UI feature addition, and this phase's mandate is audit + regression
tests, not new features (AGENTS.md §17: "Avoid adding features outside the
requested scope without approval"). No marketing copy currently overstates
this (§2's Lebanon-inclusive promise is delivered correctly); the gap is
between *built backend capability* and *delivered frontend capability*,
not between *promised* and *delivered*.

**Regression tests added**
(`tests/unit/plan-geography-consistency.test.mjs`, 3 tests): pin the real
current hardcoded-null behavior via a source-text assertion (so an
intentional future change is a deliberate, reviewed diff, not silent),
prove the real consequence against the unmodified `checkJobEligibility()`,
and prove what the toggle *does* still deliver (Lebanon-inclusive remote
+ Gulf relocation) so the working parts stay protected too.

---

## 4. Verified consistent — no change needed

- **Relocation market catalog**: `public.locations` (queried live)
  contains exactly Saudi Arabia, Qatar, Kuwait, and 3 UAE-city entries
  (Dubai/Abu Dhabi/Anywhere) with `is_relocation_market=true` — matches
  `Pricing.tsx`'s exact claim ("Saudi Arabia, Qatar, Kuwait, or the UAE"),
  no drift.
- **UI gating**: the entire "International job search" section in
  onboarding is wrapped in `{isPro && (...)}` — a Free/Student user
  structurally never sees Pro-only copy or controls, never a
  disabled-but-visible upsell that could confuse plan boundaries.
- **Dashboard banner** (`InternationalPreferencesReminderBanner.tsx`):
  only ever shown when `international_search_enabled` is already true
  (Pro-only state) with incomplete follow-up fields — correct copy
  ("Your Lebanon matches keep coming as usual"), never shown to non-Pro
  users.
- **Server plan catalog** (`get_public_plan_catalog()`, per
  `docs/PRICING.md` §8): returns only `plan_code, display_name,
  price_amount, currency, billing_period, job_match_limit,
  cover_letter_limit` — no geography field exists here at all, so there is
  no geography claim in this layer that could drift from the real
  eligibility logic.
- **Pricing not changed**: confirmed via `git diff` — no migration, no
  `publish_price_version` call, no price/currency/billing-period edit
  anywhere this phase.
- **Settings pages**: no separate preferences-editing UI exists outside
  `/onboarding/preferences` — nothing to audit for drift there.

---

## 5. Validation

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run test:unit` | **636/636** (3 new Phase 18 consistency tests) |
| `npm run test:workflow` | 360/360 (unchanged) |
| `npm run test:db` | **542/542** (one transient flake, confirmed non-reproducing on immediate retry — same known pattern as Phases 14/16/17) |
| `npm run build` | succeeds |
| `npm run test:e2e` | 6/6 |

No pricing, entitlement rule, or database schema was changed this phase —
confirmed by `git diff` containing only a new test file and this document.

---

## 6. Recommendation for a future phase (not this one)

If Pro's "expand your search outside Lebanon" toggle is meant to unlock
genuinely broader remote coverage (not just Gulf relocation), a real UI
addition is needed: a `job_market_coverage` selector in the international-
preferences section (e.g. "Lebanon-friendly remote only" /
"MENA-region remote" / "Worldwide remote"), wired to the already-working
backend parameter. Until then, the toggle's real, delivered value is
entirely the Gulf-relocation path — worth being explicit about internally,
even though current marketing copy does not overstate it.
