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

**Flexible vs. unknown (product-completion phase, Section A)**: these are
two separate states and must never be conflated. `flexible` is a real,
explicit user choice meaning "I am open to Remote, Hybrid, and On-site
opportunities" — it is why `compareKnownArrangement` treats `flexible` on
either side as always `match` (see the table above). `unknown` means the
*job's* arrangement was never stated, or the *user* never set a
preference at all — a gap in data, not a choice. A user who selects
Flexible is matched against remote, hybrid, and onsite jobs alike (proven
end-to-end in `tests/db/matching-rerank.test.mjs`'s "a real persisted
'flexible' preference matches real remote, hybrid, and onsite jobs
alike"); the onboarding UI shows a short inline helper note under the
Flexible option (`src/app/onboarding/preferences/page.tsx`,
`WORK_ARRANGEMENT_OPTIONS`) explaining the benefit without promising
guaranteed results — proven visible and correctly worded in
`tests/e2e/preferences-work-arrangement.spec.ts`.

---

## Missing skills (product-completion phase, Section B)

**What it is**: `matches.missing_skills` (`jsonb` array of short strings)
is explanatory output attached to one specific matched job for one
specific AI Career Profile — never a separate hard filter, never a reason
to auto-reject a job, and never a shared/global field. It is generated by
the same LLM rerank call that produces the match `score`/`reason`
(`src/lib/matching/rerankPrompt.ts` -> `rerankResponse.ts` ->
`saveMatch.ts`), grounded only in the CANDIDATE PROFILE and JOB LISTING
text actually given to the model in that one prompt.

**Semantics enforced in the prompt** (`buildRerankPrompt`,
`RERANK_RESPONSE_SCHEMA_DESCRIPTION`): list only a skill the job listing
explicitly asks for that is genuinely absent from the profile; never
flag a skill the profile already has, or an obvious equivalent, as
missing (e.g. profile has React and the job wants React — not missing;
profile has Next.js and the job wants React — still not missing); return
an empty array rather than guessing when the job listing does not clearly
state required skills. Schema validation
(`src/lib/matching/rerankResponse.ts`) rejects a non-array, a non-string
element, or a malformed response outright, so a broken/hallucinated shape
never reaches the database.

**Persistence**: one `matches` row per `(user_id, job_id, cv_analysis_id)`
triple (`matches_user_job_analysis_key`, see `saveMatch.ts`), so a re-rank
upserts the same row rather than duplicating it, and a different job or a
different (newer) CV analysis always gets its own independent row — an
older/stale analysis's `missing_skills` can never leak into a newer
analysis's match for the same job (proven in
`tests/db/matching-rerank.test.mjs`'s "missing_skills:" tests).

**UI**: `src/components/dashboard/MatchCard.tsx` renders missing skills as
plain amber pill badges (e.g. "AWS", "Docker") only when the array is
non-empty — no section at all for an honest empty result, and no
judgmental language ("you are unqualified") anywhere in the copy.

**Do not** add a second field for the same concept, use missing skills to
change match score weighting, or auto-reject a job for having missing
skills — none of that is this product's architecture, and changing it
requires a new, explicit founder decision.

---

## Cover letters (product-completion phase, Section C)

**Flow**: a cover letter is only ever offered for a match the user has
already approved (`matches.status = 'user_approved'`) that doesn't yet
have a `cover_letters` row (`findCoverLetterCandidates`,
`src/lib/coverLetters/candidates.ts`) — matching this doc's own "coherent
product flow" (CV -> profile -> eligibility -> match -> user review ->
optional cover letter -> user edits -> explicit approval -> nothing sent
without it). Generation is grounded only in the current eligible AI
Career Profile, the matched job, and the match's own explanation/strengths
(`src/lib/coverLetters/prompt.ts`) — never raw CV text, never invented
experience. The n8n workflow that performs the actual generation call
(`n8n-workflows/ai-job-agent-03-cover-letter-generation.ts`) stays
`active: false` in its repo JSON; activating it requires a separate,
explicit, later authorization.

**Plan limits — authoritative, not invented**: `plans.cover_letter_limit`
(`supabase/migrations/20260802090000_create_plans.sql`) is Free = 1,
Student = 8, Pro = 15. Student and Pro are monthly subscriptions
(`plans.billing_period = 'monthly'`) and the allowance is **per paid
billing period, not lifetime** (founder decision, 2026-09-30) —
`computeRemainingQuotaByUser` in `src/lib/coverLetters/candidates.ts`
counts only `cover_letters` rows whose `created_at` falls within the
user's real `subscriptions.current_period_start`/`current_period_end`
window (the same period fields `activate_subscription` and
`mark_payment_verified` already maintain for every activated paid
subscription — see `20260802090010_create_subscriptions.sql` and
`20260903090000_add_price_versioning_and_upgrade_locking.sql`; no new
period concept was introduced). A new billing period (renewal) makes the
allowance available again automatically, because the count is derived
from the period window each time rather than from a mutated counter —
no cron/reset job is needed or exists. The Free plan (`billing_period =
'forever'`) has no period fields at all, so it keeps its original
lifetime-total-of-1 behavior; that is unchanged. The count is the number
of real `cover_letters` rows in the relevant window (a row is only ever
created by a successful, cost-incurring generation), so **editing an
existing draft before approval never consumes additional quota** —
`saveCoverLetterDraft` updates the same row rather than inserting a new
one. The limit and period are read from the user's real `subscriptions`
row joined against the real `plans` table inside
`findCoverLetterCandidates` — never a client-supplied plan, period, or
count. Proven per-plan (not just Free), including period-reset and
Student-to-Pro upgrade-within-period behavior, in
`tests/db/cover-letter-generation.test.mjs`.

**Upgrade within a billing period**: `mark_payment_verified`'s existing
`purchase_type = 'upgrade'` branch already preserves
`current_period_start`/`current_period_end` exactly — an upgrade never
moves the period (AGENTS.md-documented rule, not new). Because the
cover-letter quota is derived from that same period window, a Student who
upgrades to Pro mid-period keeps the letters they already generated as
Student counted against their new, larger Pro limit for the remainder of
that period (e.g. 5 of 8 Student letters used -> upgrade to Pro -> 10
remaining, not a fresh 15 and not 0) — a direct, non-invented consequence
of period-scoped counting plus the pre-existing period-preservation rule,
not a new business rule.

**Idempotency**: `cover_letters.match_id` carries a real unique index
(`cover_letters_match_id_key`), so at most one cover-letters row can ever
exist per match even under a concurrent generation race — proven directly
in `tests/db/cover-letter-generation.test.mjs`.

**Editing and approval**: `generated_content` (the original AI output) and
`approved_content` (frozen at approval time, via the `approve_cover_letter`
RPC) are two separate columns — editing before approval
(`save_cover_letter_edit` RPC) never touches `generated_content`, so both
the original generation and the user's final approved version remain
independently inspectable without any additional versioning scheme. Once
approved, further edits are rejected outright (`matches-cover-letters-
applications.test.mjs`) — the approved version is the single source of
truth for anything downstream (e.g. an email application body).

**Submission safety**: generating or approving a cover letter is never
itself consent to send anything. An `applications` row only becomes
sendable through its own explicit approval step, entirely separate from
cover-letter approval — see the existing `applications`/`automation_tasks`
tests in `tests/db/matches-cover-letters-applications.test.mjs`. Manual
LinkedIn application behavior (link + prepared materials only, no
automated submission) is unchanged by any of this.

---

## Job-match active capacity and daily delivery (Model C, founder decision 2026-09-30)

**What changed**: `plans.job_match_limit` used to mean "total matches ever
surfaced for one user + their current CV analysis, never decrementing" —
once a user hit 45 (Student) or 95 (Pro), no further match would ever
surface again for that analysis, even after rejecting matches or a job
closing. The founder explicitly redefined this: `job_match_limit` is now
**active/current opportunity capacity** — how many genuinely-current
opportunities may occupy a user's pool *at one time*, not a running total.
Historical matches are never deleted or hidden; a match simply stops being
counted once it is no longer current.

**Values**: Student = 45, Pro = 95 active-capacity slots; Free = 1
(unchanged). A second, new column, `plans.daily_new_match_limit`, caps how
many *new* matches may be surfaced in one UTC calendar day: Student = 5,
Pro = 10, Free = `NULL` (no daily gate — Free's capacity of 1 already
bounds delivery at least as tightly, so no new Free product decision was
needed or made).

**Authoritative source — one place, two columns**: both values live only
in `public.plans` (`job_match_limit`, `daily_new_match_limit`). To change
either later: update that row via a new forward migration (never edit an
already-applied one) — no application, matching, or workflow code needs to
change, ever. `tests/unit/job-match-limit-centralization.test.mjs` proves
this by statically scanning every matching-pipeline file for a stray
literal `45`/`95`/`5`/`10` and by asserting `surface_new_matches_for_user()`
reads both values from `public.plans` in one query.

**The active-capacity predicate — one authoritative place**:
`count_active_matches_for_user()` (`supabase/migrations/20260930160000_
add_model_c_active_capacity_and_daily_limits.sql`) is the only place this
logic is ever evaluated; nothing else re-derives it. A match occupies a
slot when: it has been surfaced (`surfaced_at is not null`); its status is
`pending_review` or `user_approved` (`user_rejected` never counts); its
job's `status = 'active'` (expired/closed/unavailable/rejected/source_error
never count); and it has no `applications` row with `status = 'sent'` (a
completed send is "conceptually finished" — the founder's own words — and
moves to history; every other application state, including
`pending_send`/`sending`/`failed`/`cancelled`, is conservatively still
active, since only `sent` was explicitly named as terminal —
AGENTS.md "do not invent application statuses").

**Combined surfacing rule**: on every call,
`to_surface = min(job_match_limit − active_count, daily_new_match_limit − surfaced_today)`,
then the current analysis's highest-scoring not-yet-surfaced
`pending_review` matches fill up to that many slots — **never padded**
with weaker candidates to reach either ceiling. Both ceilings are hard
maximums, never targets: a day with only 2 genuinely strong candidates
surfaces 2, not 5.

**"Today" = the current UTC calendar day**, derived directly from
`surfaced_at` timestamps (`date_trunc('day', now() at time zone 'utc')`)
— never a rolling 24-hour window, never a mutable counter table, so no
reset job exists or is needed: the moment UTC midnight passes, "surfaced
today" naturally recomputes to 0 for every user. Running the surfacing
call multiple times in one day (e.g. a morning and an afternoon matching
run) shares one combined daily allowance, never resets per call.

**Concurrency**: `surface_new_matches_for_user()` takes a
`pg_advisory_xact_lock` scoped to the calling user before computing either
ceiling, so two overlapping calls (two tabs, a retried request, two
matching runs landing close together) can never both read the same
pre-update snapshot and jointly overshoot the active-capacity or daily
ceiling — same pattern already used by `create_payment_attempt`/
`mark_payment_verified`. Proven directly with concurrent calls in
`tests/db/daily-match-delivery.test.mjs`.

**Job lifecycle — three ways a job stops being active**:
1. **Source refresh (unchanged, pre-existing)**: `ingestSourceBatch.ts`
   marks a previously-active job `unavailable` when a *successful,
   non-truncated* ingestion run for that same source no longer lists it.
   A failed, partial, or truncated run never closes anything (`tests/db/
   ingestion-core-batch.test.mjs`'s existing "truncated run never closes
   stale jobs" / "complete run closes stale jobs" tests already prove
   both halves of this).
2. **Deadline expiry (new)**: `expire_due_jobs()` (same migration as
   above) flips `active` jobs whose `expires_at` or `closing_date` has
   passed to `expired` — idempotent, set-based, never deletes, never
   touches any other status. Not scheduled by anything yet; see
   `n8n-workflows/job-expiry-sweep.ts` (prepared, `active: false`) for the
   intended hourly trigger. `tests/db/job-expiry-sweep.test.mjs` proves
   the transition, idempotency, and that every other status is left alone.
3. **Explicit provider-closed status — DEFERRED, not missing by accident**
   (reviewed and explicitly postponed 2026-09-30, pending the upcoming
   real ingestion pilot): the remaining gap after mechanisms 1-2 is a job
   whose URL still returns 200 and is still listed, but whose page content
   itself says the role is closed/filled/no-longer-accepting-applications
   (e.g. "no longer accepting applications", "position filled", "this
   vacancy is closed"). For sources where ingestion itself is authoritative
   (every Tier A ATS — Greenhouse/Lever/Workable/Ashby/Oracle HCM — whose
   public list endpoints never include a closed posting in the first
   place, confirmed by inspecting the real raw adapter types), mechanism 1
   already fully covers this; no gap exists there. A generic "check every
   job URL for closure text" crawler was deliberately **not** built now —
   unsafe cost/ToS/false-positive tradeoffs to design against zero real
   samples, for a pre-launch product with zero ingested job rows today.
   **Target architecture, already agreed conceptually, to build once real
   ingested career-page samples exist from the upcoming pilot**:
   1. trust structured ATS/provider data first (already true — no gap).
   2. map `schema.org/JobPosting`'s existing `validThrough` property (the
      career-page extractor already parses this object, just not this one
      field yet) into `jobs.closing_date`, feeding the already-built
      `expire_due_jobs()` sweep — smallest, safest first increment.
   3. plain HTTP GET for server-rendered custom pages (the same
      `fetch`-via-n8n-HTTP-Request-node pattern already used everywhere in
      this pipeline) — never a new browser dependency by default.
   4. require a high-confidence **structural** signal (HTTP status
      transition, the job's own JSON-LD posting disappearing, or a
      curated phrase match scoped to the former CTA/apply-button region
      only) before ever auto-closing a job — a body-text phrase match with
      no structural corroboration must route to review, never auto-close,
      mirroring this codebase's existing "never guess, park for review"
      convention (`WorkArrangementStatus.unknown`, `retryable: null` in
      the source-intelligence-analyzer workflow).
   5. managed rendering/scraping (the existing Apify precedent — Tier C)
      only for a specific source proven, with evidence, to need
      JS-rendering — never an in-repo headless browser.
   6. never auto-close from ambiguous full-page text alone.

Once any of the three above fires, the job's `status` no longer reads
`'active'`, which alone is sufficient to remove it from candidate
selection (`shortlistJobsForUser`'s existing `.eq("status","active")`
query, unchanged) and from active capacity
(`count_active_matches_for_user()`'s `j.status = 'active'` condition) —
the same single field change achieves both "stop showing it as fresh" and
"free the capacity slot," with no separate bookkeeping.

**Do not** re-scope `job_match_limit`/`daily_new_match_limit` counting to
a specific `cv_analysis_id` (the OLD model's mistake) — active capacity is
counted per user across all of their surfaced matches, since that is what
`get_my_matches()` already shows them regardless of which analysis
produced each match. Only *which new pending_review rows are eligible to
fill a freed slot* is scoped to the current analysis (never a stale one).

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
