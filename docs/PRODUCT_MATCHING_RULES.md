# Product Matching Rules

Authoritative, durable record of deterministic product rules enforced by
`src/lib/ingestion/checkJobEligibility.ts` (the hard, pre-embedding
eligibility gate every job must pass before a user ever sees it — see
that file's own header for the full mechanism). This doc exists so a
future phase does not have to reconstruct *why* a rule exists from git
history, and does not accidentally reverse a deliberate founder decision
while fixing something unrelated. Phase-specific research/validation docs
(e.g. `docs/LEBANON_LIVE_SOURCE_EXPANSION.md`) record the *evidence* that
led to a decision; this doc records the *decision itself*, kept current.

---

## Work arrangement (added: Phase 21 follow-up)

**Rule**: missing, null, or unspecified `work_arrangement` metadata on a
job must never, by itself, be a rejection reason.

**Why**: real live-provider validation (Phase 21 — Bayt, GulfTalent,
Indeed, see `docs/LEBANON_LIVE_SOURCE_EXPANSION.md` §5) showed the large
majority of real job postings never state onsite/hybrid/remote
explicitly. The original hard rule (`workArrangement === null` -> always
ineligible) rejected 50 of 53 real ingested jobs for this reason alone —
a real, measured loss of otherwise-relevant opportunities, not a
theoretical concern.

**The model — three states, not a boolean**:

| State | Meaning |
|---|---|
| `match` | User has a stated preference; job states an arrangement; they're the same value (or either side is `"flexible"`, which is compatible with anything by definition). |
| `conflict` | User has a stated preference; job states a *different*, non-flexible arrangement. Always ineligible — explicit preferences are never weakened by this rule. |
| `unknown` | The job's arrangement is not stated, OR the user has no preference set. Never treated as a match, never treated as a conflict, and never inferred from location (a Beirut job is never assumed onsite; a Dubai job is never assumed onsite). |

**What actually happens for each state**:
- `match` -> normal eligibility rules apply (geography/plan/relocation), unchanged from before this decision.
- `conflict` -> ineligible (`work_arrangement_conflict`), full stop, regardless of geography or plan.
- `unknown` -> the job's eligibility is decided by evaluating it under *both* possible geographic interpretations (as if it required physical presence, and as if it were remote) and granting eligibility if *either* would independently succeed. This can never make a Student-plan user eligible for a job outside Lebanon, or a non-relocating Pro user eligible for a foreign onsite-shaped job — those rules apply independently of arrangement either way. It only removes "the arrangement is unknown" as its own, independent rejection reason. If neither interpretation would grant eligibility, the job stays ineligible (`work_arrangement_unknown_and_ineligible`) — this is a real geographic/plan rejection, not a consequence of the arrangement being unknown.

**Never do this**: infer `onsite`/`hybrid`/`remote` from a job's city or
country, or from any other field, to "resolve" an unknown value. The
value stays `unknown` and is represented as such everywhere (data,
eligibility status, and — where shown — the UI: "Work arrangement not
specified", never a fabricated claim).

**Score/explanation impact**: there is no deterministic work-arrangement
score component in this product (match `score`/`score_breakdown` are
entirely LLM-generated — see `src/lib/matching/saveMatch.ts`). An unknown
arrangement receives no positive points as if it matched, and no penalty
as if it conflicted — it simply carries no arrangement signal into the
LLM rerank prompt, which already omits the line entirely when a job's
arrangement is null (`src/lib/matching/rerankPrompt.ts`). This was
already correct before this decision and was not changed.

**Implementation**: `src/lib/ingestion/checkJobEligibility.ts`
(`WorkArrangementStatus`, `compareKnownArrangement`,
`evaluatePhysicalPresenceEligibility`/`evaluateRemoteEligibility`),
wired end-to-end via `src/lib/matching/rerankCandidates.ts`'s
`loadUserContext` (now reads `job_preferences.work_arrangement`) and
`src/lib/matching/shortlist.ts`. UI: `src/components/dashboard/MatchCard.tsx`
shows "Work arrangement not specified" instead of silently omitting the
field. Regression tests: `tests/unit/check-job-eligibility.test.mjs`
(unit-level match/conflict/unknown matrix) and
`tests/db/matching-rerank.test.mjs` (real end-to-end propagation: a
persisted `job_preferences.work_arrangement` row, read by the real
`loadUserContext`, actually changing which jobs reach rerank).

**Do not reverse this rule** by reintroducing an unconditional
`workArrangement === null -> ineligible` check, or by inferring an
arrangement from location, without a new, explicit founder decision.

---

## Market coverage (finalized: legacy market-coverage cleanup)

**Rule**: market coverage (which markets the system is even allowed to
search/match against) is entirely **plan-derived**. The user never
chooses between MENA, Gulf, Worldwide, or any raw coverage tier — those
are not user-facing product choices, and no UI in this codebase exposes
them (verified: `src/app/onboarding/preferences/page.tsx` and
`tests/e2e/preferences-job-market-coverage.spec.ts`'s "no raw market
tier is exposed" assertion).

**Canonical Pro entitlement — one coherent tier, not competing sub-tiers**:

| Plan | Effective market entitlement |
|---|---|
| Student / Free | Lebanon only |
| Pro | Lebanon + Gulf + worldwide international remote |

`job_market_coverage` has exactly two possible states: `null` (no
international remote coverage — the Free/Student/not-yet-opted-in state)
or `'remote_worldwide'` (Pro, opted in). There is no Pro sub-tier that
grants MENA-only remote access as a distinct product offering — Gulf
remote and worldwide remote are not two entitlements to reconcile, they
are both delivered through the single `remote_worldwide` tier
(`evaluateRemoteEligibility()` in `checkJobEligibility.ts` accepts any
job with a determinable remote scope once this tier is active, GCC/MENA
included).

**Derivation** (`save_job_preferences`): `international_search_enabled =
true` AND `work_arrangement in ('remote', 'flexible')` → `remote_worldwide`;
otherwise `null`. Never client-supplied — the RPC has no parameter for
it at all.

**Legacy tiers are fully retired, not merely unused**
(`supabase/migrations/20260930140000_remove_legacy_market_coverage_compatibility.sql`):
`remote_mena`, `lebanon_only`, and `remote_lebanon_applicants` were
development-era states from before the product's market model was
finalized. They are now structurally impossible, not just unreachable:

- The `job_preferences_job_market_coverage_check` CHECK constraint was
  tightened to `check (job_market_coverage in ('remote_worldwide'))` —
  Postgres rejects any other non-null value at the schema level, for
  every write path (RPC, direct authenticated write, service-role —
  a CHECK constraint is not an RLS policy).
- `checkJobEligibility.ts` no longer has any branch that interprets these
  values — `evaluateRemoteEligibility()` is a simple `jobMarketCoverage
  !== "remote_worldwide"` check, nothing more.
- The `JobMarketCoverage` TypeScript type is a single literal
  (`"remote_worldwide"`), not a union — a legacy value is now a compile-
  time type error anywhere it would be constructed, not just a runtime
  rejection.
- No seed script, fixture, or doc constructs one.

This is a deliberate, final decision, not the earlier stop-before-
destructive-cleanup posture: an earlier task found a real, once-live
onboarding UI picker (git commits `b54b342`..`a28b586`, live on `main`
2026-08-03 to 2026-09-03) that could have written any of the four raw
values to a real production row, and stopped short of removing read
compatibility because production state couldn't be verified. **That
concern does not apply to this project** — there is no production
database and no real production users. Any row this project's only
database held for a retired value was normalized to its canonical
target (`remote_mena` → `remote_worldwide`; `lebanon_only`/
`remote_lebanon_applicants` → `null`) before the constraint was
tightened, verified with a hard zero-remaining-rows check inside the
same migration. See `docs/LEBANON_GULF_PLAN_CONSISTENCY_AUDIT.md` §9-§10
for the full history.

**Server-authoritative, never trust the client**: market entitlement is
derived from `subscriptions.plan_code` (read server-side inside
`save_job_preferences` and inside `enforce_job_preferences_eligibility_trigger`),
never from anything the frontend sends. A Student cannot gain Pro market
coverage, and no user (Student or Pro) can set any retired tier, through
any payload manipulation — enforced at both the trigger level (business
rules: plan/country/work-arrangement validation) and the schema level
(the CHECK constraint itself).

---

## Market coverage vs. work arrangement vs. relocation — kept separate, never mixed

Three distinct concepts, each with its own field(s) and its own rule
above — a change to one must never implicitly change another:

- **Market coverage** (`job_market_coverage`, this section): *where the
  plan allows the system to search/match at all.* Plan-derived, not a
  user choice.
- **Work arrangement** (`work_arrangement`; see "Work arrangement"
  section above): remote / hybrid / onsite / flexible — a normal user
  preference, compared against each job's own stated arrangement via the
  match/conflict/unknown model.
- **Relocation** (`willing_to_relocate` + `job_preference_relocation_locations`):
  whether the user is willing to relocate for a non-Lebanon **physical-
  presence** (onsite/hybrid) role. Gates `evaluatePhysicalPresenceEligibility()`
  only — entirely independent of `job_market_coverage`, which gates the
  separate **remote** path (`evaluateRemoteEligibility()`). A Pro user
  with international search on and `willing_to_relocate = false` still
  gets full `remote_worldwide` coverage (Lebanon + Gulf + worldwide
  remote); they just can't be matched to a Gulf onsite/hybrid role, which
  requires physical relocation regardless of remote coverage.

**`international_search_enabled`**: still meaningful, unchanged semantics
— it is the user's own on/off switch for whether they want international
opportunities included at all. The Pro plan determines *what markets are
allowed* (the ceiling); `international_search_enabled` determines
*whether the user actually wants them* (on/off within that ceiling). Off
is a complete, intentional, valid state (see "Work arrangement" section's
sibling rule for the analogous `unknown` case) — never treated as
incomplete onboarding.

---

## Geography, plan, and relocation — remaining pre-existing rules

- MVP market is Lebanon-only for Free/Student plans.
- A low-confidence resolved location is never eligible, regardless of
  plan (fails closed).
- A Pro user who never qualifies for a derived `job_market_coverage` is
  treated exactly like `remote_lebanon_applicants` — never silently
  granted wider access than they opted into.
- Gulf relocation markets (onsite/hybrid): SA, QA, KW, AE — see
  `job_preference_relocation_locations` and the "Relocation" bullet above.
