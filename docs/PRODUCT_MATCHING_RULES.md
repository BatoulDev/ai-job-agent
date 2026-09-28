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

## Geography, plan, and relocation (pre-existing, unchanged by the above)

Recorded here for completeness since this doc is now the intended
central reference — not modified by the Phase 21 follow-up decision.

- MVP market is Lebanon-only for Free/Student plans.
- Pro-only structured international preferences: `job_market_coverage`
  (`lebanon_only` | `remote_lebanon_applicants` | `remote_mena` |
  `remote_worldwide`), `international_search_enabled`,
  `willing_to_relocate`, and a relocation market catalog (Gulf markets:
  SA, QA, KW, AE).
- A low-confidence resolved location is never eligible, regardless of
  plan (fails closed).
- A Pro user who never qualifies for a derived `job_market_coverage` is
  treated exactly like `remote_lebanon_applicants` — never silently
  granted wider access than they opted into.
- **Resolved** (job_market_coverage wiring fix,
  `supabase/migrations/20260930110000_derive_job_market_coverage_server_side.sql`):
  `job_market_coverage` is no longer a client-supplied value —
  `src/app/onboarding/preferences/page.tsx` never sends it, and
  `save_job_preferences` derives it server-side: `international_search_enabled
  = true` and `work_arrangement in ('remote', 'flexible')` derives
  `remote_worldwide`; otherwise `null`. `willing_to_relocate` is
  deliberately NOT part of this derivation — it gates the separate
  onsite/hybrid physical-presence path above, not this field. This closes
  the gap Phase 18's `docs/LEBANON_GULF_PLAN_CONSISTENCY_AUDIT.md`
  originally found (backend supported the tiers; no UI/RPC path ever set
  them). `remote_mena` remains a supported column value with no current
  derivation path — no product requirement distinguishes it from
  `remote_worldwide` today.
