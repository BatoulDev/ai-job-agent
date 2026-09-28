# Overnight Source Expansion — Final Report (Phases 15-18)

Autonomous overnight build, Lebanon + Gulf source coverage. Started from
`main` @ `734a3f7` (Phase 14 merged). Ends at `phase/18-plan-coverage-
consistency` @ `59d7b10`, a linear 4-commit stack on top of that same
`main` HEAD — nothing was merged, nothing was activated, nothing was
deployed, no real external application or email was sent at any point.

---

## 1-4. Branches, commits, merge status, manual merge order

| Branch | Commit | Contains |
|---|---|---|
| `phase/15-lebanon-gulf-source-research` | `535ed15` | Research only |
| `phase/16-lebanon-gulf-source-expansion` | `7848208` | Implementation |
| `phase/17-ingestion-adversarial-hardening` | `4fa4f71` | Real validation |
| `phase/18-plan-coverage-consistency` | `59d7b10` | Audit |

**All four are pushed to `origin`. None are merged into `main`** — the
`gh` CLI is unavailable in this environment (confirmed earlier this
session) and I do not have another safe, non-interactive way to open a PR
or merge, per the explicit fallback instruction ("do not stop the
overnight build... commit + push... create the next phase branch from the
latest validated previous-phase HEAD... continue").

**Manual merge order — simpler than it looks**: each branch was forked
directly from the previous one (`15→16→17→18`, verified via
`git merge-base --is-ancestor` after every branch creation), so this is
one linear stack, not four independent lines. **You only need one PR**:

```
phase/18-plan-coverage-consistency → main
```

Merging that one branch brings in all four phases' commits in the correct
order. Opening individual PRs for 15/16/17 first is not necessary unless
you want to review them as separate units — if so, merge them in order
(15, then 16, then 17, then 18), since each depends on the one before it.

---

## 5. Research conclusions (Phase 15)

Full detail: `docs/LEBANON_GULF_SOURCE_RESEARCH.md`. Headline: ATS-specific
adapters have a hard ceiling (~53 companies across all 5 countries);
Bayt + GulfTalent (via Apify) are the only components that meaningfully
reach Lebanon's real job market at scale (~716 and ~477 real listings
observed respectively). Oracle Cloud Recruiting confirmed as the
strongest immediately-buildable native adapter (23 registry companies, all
5 countries, live-verified). JSearch real-covers Saudi/Qatar/UAE only, not
Lebanon/Kuwait. Adzuna covers none of the 5 target markets — excluded.

## 6-8. New providers, ATS adapters, Apify integrations implemented (Phase 16)

- **New native ATS adapter, live and wired**: Oracle Cloud Recruiting
  (`providers/oracle-hcm.ts`) — Tier A, in the n8n workflow, real HTTP
  calls.
- **New adapter, code-complete, not wired**: Workday
  (`providers/workday.ts`) — real API confirmed, but its list endpoint
  carries no job description, so it's not usable without a second per-job
  fetch (a real, scoped, not-yet-built follow-up).
- **New Apify-backed adapters, code-complete, not live**: Bayt
  (`providers/bayt.ts`), GulfTalent (`providers/gulftalent.ts`) — written
  from the actors' own documented schemas, `enabled:false` pending an
  authorized benchmark run.
- **Career-page extraction**: candidate limit raised 20→50; a pure
  link-discovery helper (`findCareerPageJobDetailLinks.ts`) built but not
  wired into the fetch loop.
- **Registry**: 3 genuinely new Lebanon companies promoted via the
  existing `resolve_registry_candidate()` RPC (of 18 nominal candidates
  from an already-completed Apify pilot — 15 turned out to already be in
  the registry after a real dedup check).

## 9. Bayt result

**Not live.** Real, mature, well-documented Apify actor identified
(`blackfalcondata/bayt-scraper`, 557 users, 100% success rate, ~$0.99/1k
results). Adapter code is ready. No credits have been spent on it — this
is the single highest-leverage remaining founder action (§25).

## 10. Lebanon coverage — before vs after (real, measured, not estimated)

| | Before (Phase 14 baseline) | After (Phase 17, real bounded execution) |
|---|---|---|
| Real jobs, `country_code='LB'` | **0** | **5** (all Oracle Cloud Recruiting, AUBMC) |
| Of those, currently matching-eligible | 0 | **0** — Oracle's API returns no work-arrangement data for this tenant; `checkJobEligibility()` correctly fails closed rather than guessing |

**Lebanon's practical, user-facing improvement from this overnight build
is currently zero**, despite real ingestion succeeding — stated plainly,
not softened. The real lever for Lebanon (Bayt/GulfTalent) was not
authorized to run.

## 11. Gulf coverage — before vs after, by country

| Country | Before | After | Source |
|---|---|---|---|
| Saudi Arabia | ~25 (unchanged — no new SA adapter this build) | 25 | Existing Workable/Greenhouse/Lever |
| Qatar | ~4 (unchanged) | 4 | Existing Ashby/Workable |
| Kuwait | 0 | 0 | **No Kuwait source added this build** |
| UAE | ~1 (Lever, unresolved country before) | **7** | +5 real Oracle jobs (NMC Specialty Hospital), 1 Lever/Wahed |

UAE saw the only real net-new Gulf gain this build, via the second,
automatically-discovered Oracle tenant. Kuwait remains the weakest Gulf
market — unaddressed.

## 12. International remote status

Unchanged and out of scope, per your explicit instruction not to expand
this lane. RemoteOK/Jobicy/Arbeitnow continue working exactly as Phase 14
left them (jobicy/arbeitnow even picked up 5 new real postings each during
Phase 17's real runs, since they're live continuously-updated feeds).

## 13. Real job counts (final, directly queried)

**93 total real jobs** (up from 73 at Phase 14/15's start):
`admin_manual:1, arbeitnow:10, ashby:5, greenhouse:16, jobicy:10, lever:8,
oracle_hcm:10, remoteok:5, workable:28`. By country:
`SA:25, AE:7, US:6, LB:5, QA:4, IN:2, CA:1, (null):43`.

## 14. Apply URL quality

**0 of 93 rows** have neither `application_url` nor `application_email` —
every stored job has a usable path to apply. 2 real, newly-created Oracle
apply URLs spot-checked directly this phase — both return real, live
**HTTP 200**. No apply URL was ever invented.

## 15. Null location/work-arrangement findings

43/93 (46%) have `country_code:null`, 51/93 (55%) have
`work_arrangement:null` — every one confirmed to be a genuine "the source
didn't say" case, never a guess (verified directly, including with real
Arabic-script location text this phase, which correctly fails closed). The
practically important instance: **all 10 real Oracle jobs have
`work_arrangement:null`**, which is why Lebanon's real ingested jobs
aren't reaching matching yet (§10).

## 16-17. Bugs found / bugs fixed

**Zero real bugs were found in Phases 17-18.** Phase 16's implementation
work surfaced no new defects either — every "finding" in this build
(Lebanon jobs ineligible due to missing work-arrangement data, Student
seeing Lebanon-inclusive worldwide remote jobs, `job_market_coverage`
being frontend-unreachable) is existing, correct, fail-closed code
behaving exactly as designed against real data — documented, not patched,
per each phase's own explicit scope boundary.

## 18-19. Worst-case tests / Playwright tests

Adversarial testing (Phase 17): most of the worst-case list was already
covered by the existing 630+ test suite; one real, new gap closed —
Arabic-script location text (3 new tests, `normalize-location.test.mjs`).
Playwright: no ingestion UI exists to browser-test; the existing 6
dashboard e2e specs were re-run clean after every phase, confirming no
regression in the user-facing product from any backend/ingestion change
this build made.

## 20. Idempotency results

**Proven on real data, including the new Oracle source.** Two identical
real bounded executions (133016, 133108): every source shows
`jobsCreated:0, jobsUpdated:N` on the second run; DB total unchanged at 93
rows both times; 0 duplicate `(dedup_scope, external_id)` pairs, both
times.

## 21. Matching handoff

Proven end-to-end for a real Gulf job with complete data (Qatar, onsite):
correctly shortlisted for Pro-with-relocation, correctly excluded for
Student and Pro-without-relocation. Also proven, honestly, for the real
Lebanon job: correctly excluded due to unknown work-arrangement — the real
current state, not a target state.

## 22. Plan / frontend / backend consistency

Audited in Phase 18 (`docs/LEBANON_GULF_PLAN_CONSISTENCY_AUDIT.md`).
System is largely consistent — no false marketing promise found. One real
gap: `job_market_coverage`'s `remote_mena`/`remote_worldwide` tiers are
backend-complete but frontend-unreachable (no UI sets them). Documented
and regression-tested, not fixed (a real UI feature addition, out of this
audit's scope).

## 23. Missing credentials

See `docs/OVERNIGHT_CREDENTIALS_REQUIRED.md` for full detail:
- **`APIFY_API_TOKEN`**: already present and working. What's missing is
  explicit authorization to spend real (small) credits on Bayt/GulfTalent.
- **`JSEARCH_API_KEY`**: not obtained; free tier sufficient; covers
  Saudi/Qatar/UAE only.
- **`ADZUNA_APP_ID`/`ADZUNA_APP_KEY`**: not worth obtaining for this
  priority — confirmed zero MENA/Gulf coverage.

## 24. Remaining blockers

1. Bayt/GulfTalent not live (needs founder authorization, §25).
2. Lebanon's real ingested jobs aren't reaching matching (needs either an
   Oracle-side data fix outside this project's control, or a future
   phase's deliberate default-inference decision — not invented here).
3. Career-page extraction still finds zero real jobs even at the raised
   limit — the link-discovery fix is built but not wired in.
4. Kuwait has no dedicated new source from this build.
5. `job_market_coverage` UI gap (§22) — real but not overpromised anywhere.
6. Everything already tracked in `docs/PRODUCTION_READINESS.md`
   (rate limiting, GDPR/account deletion, upload content-validation) is
   unchanged and still applies.

## 25. Exact founder actions for tomorrow, in priority order

1. **Merge `phase/18-plan-coverage-consistency` into `main`** (one PR,
   §4) — everything is validated and ready.
2. **Authorize a small, bounded Bayt + GulfTalent Apify benchmark run**
   (well under $1 total, `maxItems` 50-100 each) — the single highest-
   leverage action for Lebanon/Gulf coverage. Once run: confirm the real
   dataset matches `bayt.ts`/`gulftalent.ts`'s field names, fix any drift,
   flip `providerConfig.ts`'s `enabled:true` for both, then run the same
   real-execution + idempotency + matching-handoff validation this build
   used for every other provider.
3. Optionally obtain a free-tier `JSEARCH_API_KEY` (Saudi/Qatar/UAE only).
4. Decide whether the Workday per-job-detail-fetch and career-page
   link-following wiring (both code-complete) are worth a follow-up phase.
5. Decide whether `job_market_coverage`'s UI gap (§22) is worth building.

## 26. Is the system ready for a real user end-to-end test?

**Yes, for the already-proven 7 providers from Phase 14 plus Oracle Cloud
Recruiting — no, if "real user test" means Lebanon coverage specifically.**
The pipeline itself (ingestion → persistence → idempotency → eligibility →
matching) is proven correct and stable across all 4 phases of this build,
including under real adversarial conditions. But a real Lebanon-based
Student user testing the product tonight would see the same weak Lebanon
lane Phase 12 first identified — this build proved the pipeline works, it
did not yet close the Lebanon coverage gap, because the one component
that would (Bayt/GulfTalent) was correctly left for explicit founder
authorization rather than run unilaterally. **Do not claim Lebanon
production-readiness until #2 above is done and validated.**
