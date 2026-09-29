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
below, not fixed at the time (a UI addition is a real feature, outside
this audit's scope; since resolved via server-side derivation — see §7,
further simplified into one coherent Pro tier — see §8, legacy-value
cleanup initially stopped short of destructive changes after a real
historical write path was discovered — see §9 — and finally fully
removed once confirmed this project has no production database or users
— see §10). No false marketing promise was found: the one plan-geography claim
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

**Superseded — see §7 and §8.** The UI-picker approach recommended below
was explicitly overridden by founder direction: market coverage is
plan-derived, never a user-facing picker. Kept verbatim for historical
record of what was considered.

If Pro's "expand your search outside Lebanon" toggle is meant to unlock
genuinely broader remote coverage (not just Gulf relocation), a real UI
addition is needed: a `job_market_coverage` selector in the international-
preferences section (e.g. "Lebanon-friendly remote only" /
"MENA-region remote" / "Worldwide remote"), wired to the already-working
backend parameter. Until then, the toggle's real, delivered value is
entirely the Gulf-relocation path — worth being explicit about internally,
even though current marketing copy does not overstate it.

---

## 7. Resolved (job_market_coverage wiring fix)

The gap in §3 is fixed, without the UI-picker approach §6 anticipated. Per
explicit founder direction, the user never chooses a raw backend coverage
value — `job_market_coverage` is derived server-side inside
`save_job_preferences`
(`supabase/migrations/20260930110000_derive_job_market_coverage_server_side.sql`)
from `international_search_enabled` + `work_arrangement`
(`remote_worldwide` when international is enabled and the arrangement is
remote/flexible, else `null`), and existing rows were backfilled using the
identical derivation. The onboarding page no longer sends
`p_job_market_coverage` at all — the parameter was removed from the RPC
signature, not merely stopped being populated. See
`docs/PRODUCT_MATCHING_RULES.md` ("Market coverage") for the current,
durable statement of this rule, and
`tests/db/international-job-preferences.test.mjs` /
`tests/db/matching-rerank.test.mjs` / `tests/e2e/preferences-job-market-coverage.spec.ts`
for the regression coverage (RPC-level derivation, real matching-path
propagation, and a real browser → RPC → DB proof, respectively).

Regression tests: `tests/unit/plan-geography-consistency.test.mjs` (3
tests, rewritten when this landed to prove the resolved state instead of
pinning the bug), `tests/unit/check-job-eligibility.test.mjs` (isolated
tier logic), and the DB/E2E tests above.

---

## 8. Resolved (Pro market-coverage model simplification)

Follow-up task, after §7 merged: eliminate the remaining competing
`remote_mena` vs `remote_worldwide` derivation path so Pro has one
coherent entitlement model (Lebanon + Gulf + worldwide remote), per
explicit product decision that the user never chooses between these —
not even indirectly.

**Audit finding**: §7's RPC-level fix already only ever derived
`remote_worldwide` — no product-facing path produced `remote_mena`. The
one remaining gap was a crafted direct write (or a service-role write)
bypassing the RPC, which the eligibility trigger did not block, since it
only validated plan/country/arrangement, not which specific tier value
was used.

**Fix** (`supabase/migrations/20260930120000_retire_remote_mena_coverage_tier.sql`,
non-destructive): `enforce_job_preferences_eligibility_trigger` now
rejects `job_market_coverage = 'remote_mena'` for any new write, from
every write path (trigger, not an RLS policy — fires for service-role
too). The `job_preferences_job_market_coverage_check` CHECK constraint
and `checkJobEligibility.ts`'s `remote_mena` branches are **unchanged** —
any pre-existing row that already holds this value stays valid, readable,
and keeps behaving under its original, narrower (GCC/MENA-only)
semantics, never silently widened. It self-corrects to `remote_worldwide`
(or `null`) the next time its owner saves through the real product path.
`lebanon_only`/`remote_lebanon_applicants` were left untouched — legacy
and unreachable via the RPC too, but not flagged as a competing-
derivation-path problem the way `remote_mena` was, and out of this task's
explicit scope.

**Correction (see §9): "unreachable via the RPC too" was true only of
the RPC as it existed by the time this task ran — it was not true
historically.** §9's git-archaeology finding shows all three values,
including these two, had a real, once-live write path via an onboarding
UI picker. Treat this paragraph as describing 20260930120000's own scope
at the time, not a claim these two values were never reachable at all.

One dev-only fixture (`scripts/seed-local-automation-users.mjs`'s Lina
Mansour) directly inserted a `remote_mena` row (bypassing the RPC,
mirroring what a legacy production row would have looked like) — updated
to `remote_worldwide`, which already covers her original "also open to
Remote MENA" note as a strict superset.

See `docs/PRODUCT_MATCHING_RULES.md` ("Market coverage" and "Market
coverage vs. work arrangement vs. relocation") for the current, durable
statement of the final model. Regression tests:
`tests/db/international-job-preferences.test.mjs` (new-write rejection,
including a Student and a service-role write) and
`tests/e2e/preferences-job-market-coverage.spec.ts` (confirms no
MENA/Gulf/Worldwide vocabulary or raw enum value is ever shown to the
user). Legacy-row behavior itself remains proven at the unit level by
`tests/unit/check-job-eligibility.test.mjs`'s existing, unmodified
`remote_mena` tests — no DB-level synthetic legacy row was constructed,
since doing so now requires bypassing the very trigger this fix adds
(not justified for one test scenario; see that test file's own comment).

---

## 9. Legacy market-coverage cleanup — stop condition hit, cleanup partial by design

Follow-up task, after §8 merged: audit whether `remote_mena`'s read
compatibility (and the other two never-actively-derived values,
`lebanon_only`/`remote_lebanon_applicants`) can be removed entirely —
CHECK constraint, `checkJobEligibility.ts` branches, and TypeScript
union — now that no write path can create any of them.

**Central finding — a real historical write path was discovered for ALL
FOUR raw values, not just `remote_mena`.** Git archaeology
(`git log --all -S "p_job_market_coverage" -- src/app/onboarding/preferences/page.tsx`)
surfaced two commits neither §3 nor §7/§8 had inspected:

- `b54b342` ("feat: streamline job preferences onboarding UI",
  2026-08-03) introduced a real, complete onboarding UI radio picker —
  `JOB_MARKET_COVERAGE_OPTIONS`: "Lebanon only" (`lebanon_only`),
  "Remote roles open to applicants based in Lebanon"
  (`remote_lebanon_applicants`), "Remote within MENA" (`remote_mena`),
  "Worldwide remote" (`remote_worldwide`) — shown whenever
  `showCoveragePicker` was true (`isLebanon && planCode === 'pro' &&
  workArrangement in ('remote', 'flexible')`, the same gate
  `enforce_job_preferences_eligibility_trigger` still enforces today).
  The user's raw selection was sent directly as `p_job_market_coverage`.
- `a28b586` ("feat: add plan-aware preferences and versioned billing",
  2026-09-03) removed the picker entirely and hardcoded
  `p_job_market_coverage: null` — the state §3's original Phase 18 audit
  found and treated as "no UI ever set this."

Both commits are on `main`'s real history. The picker was live for
exactly one month (2026-08-03 to 2026-09-03) across several intermediate
feature commits. This session has no way to confirm whether real
(non-test) users interacted with it during that window — this project
was in active pre-launch iteration at the time, but that is not proof
nobody used it, and this environment has no production database access
to check.

**Consequence**: any of the three retired values — not just `remote_mena`
— could be sitting in a real, currently-unknown row in whatever database
this application has run against since 2026-08-03. This session's
local/dev database (queried directly: 1 `job_preferences` row total,
`NULL`) is empty and not representative of production, and must not be
treated as evidence production is clean.

**Decision: stop before destructive cleanup, for all three values, per
this task's own explicit stop condition.** Concretely:

| Action | Done this task? | Why |
|---|---|---|
| Block `lebanon_only`/`remote_lebanon_applicants` as a value for any NEW write (extending §8's `remote_mena`-only block) | **Yes** — `supabase/migrations/20260930130000_normalize_legacy_market_coverage_values.sql` | Safe regardless of unknown data state — only affects future writes, and both values are already proven behaviorally identical to `null` (see below), so no supported product behavior changes. |
| Normalize any row *this* database currently holds for any of the three values (`remote_mena`→`remote_worldwide`; `lebanon_only`/`remote_lebanon_applicants`→`null`), with a hard zero-remaining-rows verification | **Yes** — same migration | Idempotent and correct regardless of whether the count is 0 or many; ships now so whichever database this eventually runs against (including production, whenever the migration is applied there) gets normalized automatically. |
| Remove the three values from `job_preferences_job_market_coverage_check` | **No — stopped** | Cannot confirm production is normalized from this environment. This is a plain `text` CHECK constraint (not a native Postgres enum), so removal itself is a low-risk DDL operation — the risk is entirely about unverified data, not constraint-removal mechanics. |
| Remove `checkJobEligibility.ts`'s `remote_mena`/`lebanon_only`/`remote_lebanon_applicants` branches | **No — stopped** | Same reason. Removing this now risks a real, currently-unverifiable production row silently falling through to the `remote_worldwide` branch (widening its access) the moment new code deploys ahead of a migration that hasn't reached that database yet. |
| Remove the three values from the `JobMarketCoverage` TypeScript union | **No — stopped** | Same reason — the type must keep describing every value the column (and any pre-existing row) can actually hold. |

**Manual verification performed this session** (documented, not committed
as an automated test — see `tests/unit/plan-geography-consistency.test.mjs`
"Legacy market-coverage cleanup" describe block and
`tests/db/international-job-preferences.test.mjs` for what *is*
automated): using `psql` directly against the local database, a synthetic
Pro/Lebanon/remote user's `job_preferences` row was set to each of the
three retired values in turn (via a temporary trigger bypass, simulating
what a real pre-migration row would look like), then the migration's
exact normalization `UPDATE` was re-run against it and confirmed to
produce the correct canonical value each time
(`remote_mena` → `remote_worldwide`, `lebanon_only` → `null`,
`remote_lebanon_applicants` → `null`), followed by confirming a live,
non-bypassed write attempt of `remote_mena` was correctly rejected by the
now-stricter trigger. The synthetic test user was deleted afterward.

**Recommended path to completing the destructive phases (Phases 5-6 of
the task spec)**: an operator with real production database access
should run the same query this migration's own verification block runs —

```sql
select job_market_coverage, count(*)
from public.job_preferences
where job_market_coverage in ('remote_mena', 'lebanon_only', 'remote_lebanon_applicants')
group by job_market_coverage;
```

— against production, both *before* deploying this migration (to learn
the real historical exposure) and *after* (to confirm the migration
actually normalized everything there, not just locally). Once that
returns zero rows on production, removing the CHECK constraint values,
the `checkJobEligibility.ts` branches, and the TypeScript union members
becomes safe, and can be done as a small, purely mechanical follow-up.

See `docs/PRODUCT_MATCHING_RULES.md` ("Market coverage") for the current,
durable statement of what was and wasn't removed and why.

---

## 10. Legacy market-coverage cleanup — final removal (§9's stop condition resolved)

Follow-up task, after §9 merged: confirmed explicitly by the user that
this project has no production database and no real production users —
§9's stop condition (an unverified historical onboarding UI picker that
could have written a legacy value to a real production row) does not
apply here. Local/dev `job_preferences` held zero rows using any legacy
value at the start of this task (re-confirmed directly against the
database).

**What changed** (`supabase/migrations/20260930140000_remove_legacy_market_coverage_compatibility.sql`):

1. Defensively re-ran the same normalization `§9`'s migration already
   applied (idempotent no-op — zero rows matched), then hard-verified
   zero rows remained before proceeding.
2. Tightened `job_preferences_job_market_coverage_check` from four legal
   values to exactly one: `check (job_market_coverage in ('remote_worldwide'))`
   (Postgres CHECK-constraint semantics: a `NULL` column value always
   satisfies an `IN` check regardless of the list, so this correctly
   still permits `null` too). `remote_mena`, `lebanon_only`, and
   `remote_lebanon_applicants` are no longer legal column values, for
   any write path — verified live via `psql` (each rejected with
   Postgres error code `23514`, `check_violation`) and via automated DB
   tests (`tests/db/international-job-preferences.test.mjs`).
3. Simplified `enforce_job_preferences_eligibility_trigger`: removed the
   `if new.job_market_coverage in ('remote_mena', 'lebanon_only',
   'remote_lebanon_applicants') then raise exception` branch §9 added —
   now fully redundant, since the CHECK constraint itself rejects those
   values as a matter of column type, before the trigger's own logic
   would even need to. The remaining checks (Pro-plan/Lebanon-country/
   work-arrangement validation for a non-null value, and the
   `international_search_enabled` Pro gate) stay — a CHECK constraint
   cannot reference other tables (`subscriptions.plan_code`,
   `profiles.country_of_residence`), so cross-table validation remains
   the trigger's job.
4. Simplified `checkJobEligibility.ts`: removed both `if (coverage ===
   "remote_mena")` branches and the `isMenaCountryCode` import they were
   the only consumer of in this file (the function itself,
   `normalizeLocation.ts`'s `isMenaCountryCode`, is untouched — it's a
   general-purpose helper with its own independent test coverage, not
   exclusive to this retired tier). `evaluateRemoteEligibility()` and the
   main function's remote/flexible branch collapsed from a 3-way
   `lebanon_only`/`remote_lebanon_applicants`/`remote_mena` dispatch to a
   single `jobMarketCoverage !== "remote_worldwide"` check.
5. `JobMarketCoverage` (`src/lib/jobPreferences/types.ts`) is now
   `export type JobMarketCoverage = "remote_worldwide";` — a single
   literal, not a 4-member union. Combined with the existing `|
   null` convention at every usage site, this makes constructing a
   legacy value a **compile-time** type error anywhere in TypeScript
   code, not merely a runtime rejection.
6. Tests rewritten, not just extended, per this task's explicit
   instruction to replace legacy-behavior tests with impossible-state
   tests: `tests/unit/check-job-eligibility.test.mjs`'s
   `remote_mena`/`lebanon_only` tier tests were replaced with tests
   proving a legacy value now behaves identically to `null` (no special
   case survives); `tests/unit/plan-geography-consistency.test.mjs`'s
   migration-mapping-pin tests were replaced with static-source-
   inspection tests proving the CHECK constraint, `checkJobEligibility.ts`,
   and the `JobMarketCoverage` type all reflect the final, single-tier
   state; `tests/db/international-job-preferences.test.mjs`'s rejection
   tests were updated from asserting a custom trigger-raised message to
   asserting the real Postgres `23514` check-violation code and message,
   plus two new tests confirming `remote_worldwide` and `null` both
   remain valid.
7. `scripts/seed-local-automation-users.mjs`'s comments were updated to
   drop references to the now-fully-retired migration numbers; its data
   was already correct (`null` / `'remote_worldwide'` only) since §8.
   Re-ran the script this session — succeeds cleanly against the
   tightened constraint.

**Not touched, correctly out of scope**: `lebanon_only`'s and
`remote_lebanon_applicants`' historical presence in older, dated
build/audit logs (`docs/OVERNIGHT_BUILD_PROGRESS.md`,
`docs/SOURCE_COVERAGE_AND_PROVIDER_EXPANSION_AUDIT.md`,
`docs/OVERNIGHT_SOURCE_EXPANSION_FINAL_REPORT.md`,
`docs/job-ingestion-database-readiness-audit.md`) — these are dated,
point-in-time reports describing what was true when they were written,
not living reference docs; retroactively editing them would misrepresent
project history. Only `docs/PRODUCT_MATCHING_RULES.md` and this file are
treated as current, continuously-updated references.

Full DB reset, validation, and Playwright results are in this task's
final report (delivered directly to the user, not duplicated here).
