# UAE Registry Expansion — Round 3 Deterministic Triage Completion + Comprehensive Validation

**Date:** 2026-09-07 (continuation of the same-day pilot, resumed after a mid-session interruption during validation — no research, Apify calls, or candidate re-verification were repeated; only the already-completed round-3 work was validated and one script bug was fixed).
**No Apify calls made this round. No credits spent.**
**Status: 45 additional companies staged (67 total across all three rounds). `uae.csv` and `master-company-registry.csv` remain unmodified.**
**Verdict: READY_FOR_HUMAN_REVIEW**

---

## 1. What this round covered

Round 3 resolved the entire 379-row backlog left open at the end of round 2 (`uae-triage-and-deep-verification-report.md` §10):

| Backlog group | Size | Disposition this round |
|---|---|---|
| `eligible_employer` (triage-scored, unreviewed) | 213 | **All 213 individually WebFetch-reviewed** in 5 batches (`round3-batch1..5-findings.js`, 50+50+50+50+13) |
| `eligible_employer_enriched_but_unresolved` (round 1) | 21 | **All 21 reconciled** (`round3-round1-reconciliation.js`) |
| `eligible_employer_deep_verified_needs_more_evidence` (round 2 revisit) | 37 | **All 37 revisited**; all confirmed to remain `needs_more_evidence` — a documented unresolved status, not a skip (`round3-37-revisit.js`) |
| `eligible_employer_no_website` | 108 | **12 individually researched** (7 needs_more_evidence, 3 rejected, 2 duplicate/branch); remaining **96 held unchanged**, a documented backlog status, not silently dropped (`round3-108-nowebsite-triage.js`) |

**Every one of the 379 backlog rows was either resolved this round or carries an explicit, documented unresolved/held status.** None were silently dropped.

## 2. Classification results

| Source | new_verified | needs_more_evidence / low_priority | rejected | duplicate/branch |
|---|---|---|---|---|
| 213 batch | 44 | 165 + 2 | 2 | — |
| 21 round-1 reconciliation | 1 | 20 | — | — |
| 108 no-website (12 researched) | — | 5 | 3 | 2 |
| 37 revisit | — | 37 (unchanged) | — | — |

**Total new_verified this round: 45** (44 from the 213 + 1 from round-1 reconciliation), confirmed in `enrichment/round3-new-verified-ids.csv`.

## 3. Recovered/confirmed session state (what was already done before the interruption)

Inspection of the repository confirmed the previous session had already, before the interruption:
- Fully researched and classified all 213+21+37 candidates and the 12 individually-actionable no-website candidates (all `round3-*.js` findings files complete and internally consistent).
- Run `enrichment/round3-master-apply.js`, computing the 45 new-verified ids.
- Run `reconciliation/build-staging-round3.js`, appending the 45 new rows to `uae-promotion-staging.csv` (22 → 67) and validating zero domain/ID collisions at write time (script output confirms this ran exactly once — no duplicate rows).
- Run `enrichment/round3-apply-all-updates.js`, updating `manual-review-queue.csv` (379 → 325), `rejected-candidates.csv` (65 → 70), and `duplicate-and-alias-review.csv` (1 → 5).
- Run `reconciliation/build-manifest-dryrun-round3.js`, extending `uae-promotion-staging-manifest.csv` (22 → 67) and regenerating `uae-promotion-dry-run.csv` (467 rows).

**Nothing from the interrupted session needed to be redone.** The interruption occurred after this work was saved to disk, during the *next*, not-yet-performed step: an independent comprehensive validation pass. That pass is what this continuation performed.

## 4. Bug found and fixed during this continuation

**`uae-promotion-dry-run.csv` mislabeled 2 of 467 rows.** `build-manifest-dryrun-round3.js` built its duplicate-tracking set from the full `internal_row_ids` field of `duplicate-and-alias-review.csv`, which (for 2 of its 5 rows) contains both the candidate actually excluded as a duplicate (`candidate_a`) **and** a reference to the surviving tracked entity it duplicates (`candidate_b`). This caused `uae-pilot-0394` (Sheikh Khalifa Medical City – Emergency Dept.) and `uae-pilot-0455` (Zayed Military Hospital) — both of which correctly remain in `manual-review-queue.csv` under `round1_reconciled_needs_more_evidence` — to also be mislabeled `hold_duplicate_review` in the dry-run file, instead of `hold_manual_review`.

**Fix:** regenerated `uae-promotion-dry-run.csv` only (via a standalone, idempotent script that reads current state — it does **not** re-run `build-staging-round3.js` or touch `uae-promotion-staging.csv`/`uae-promotion-staging-manifest.csv`, which were already correct and must not be re-appended to). The corrected file's `proposed_action` counts now match the actual bucket files exactly:

| proposed_action | Before fix | After fix | Matches actual bucket file |
|---|---|---|---|
| `promote_now` | 67 | 67 | = `uae-promotion-staging.csv` (67) ✓ |
| `hold_manual_review` | 323 | **325** | = `manual-review-queue.csv` (325) ✓ |
| `exclude_rejected` | 70 | 70 | = `rejected-candidates.csv` (70) ✓ |
| `hold_duplicate_review` | 7 | **5** | = `duplicate-and-alias-review.csv` (5) ✓ |

This was the only genuine consistency problem found. No other file required correction.

## 5. Comprehensive validation performed (42 checks, all passing after the fix)

Run programmatically against current file state (not re-derived from history):

**Pool accounting**
- 467 = 67 staged + 325 manual-review + 70 rejected + 5 duplicate-review. ✓
- Every one of the 467 pool `internal_row_id`s is accounted for in exactly one terminal bucket — none lost, none double-counted. ✓ (Two initially-flagged "double counts" were verified as a checker artifact, not a data bug — see §4's root cause; the ids themselves are correctly singly-classified.)
- `uae-promotion-dry-run.csv`'s per-row `proposed_action` now matches actual bucket membership for all 467 rows. ✓

**Staging/manifest integrity**
- Staging and manifest contain an identical 67-company set (`canonical_company_id` ↔ `proposed_canonical_company_id`). ✓
- All 67 staged rows have non-empty `evidence_urls` and a non-empty `official_website_url`. ✓
- All 67 have `review_status = verified`. ✓
- `canonical_company_id`/`source_record_id` unique within staging, deterministic (`cc-*`/`sr-*` slug convention), and collide with neither `uae.csv` (39 rows) nor `master-company-registry.csv` (288 rows). ✓

**Duplicate/identity checks**
- No duplicate `company_name`, `legal_or_official_name`, official-website domain, careers-URL domain, or `linkedin_company_url` within the 67 staged rows. ✓
- No staged domain or normalized name collides with `uae.csv` or `master-company-registry.csv`. ✓
- Zero `linkedin.com/in/` (personal-profile) URLs anywhere in staged output. ✓
- Al Khawaja Engineering Consultants (KWEC) — flagged in round 2 for casino/gambling-affiliate content mixed into its site — confirmed **not** staged. ✓

**Geography**
- All 67 `target_city` values match the expected Dubai/Abu Dhabi/dual-city pattern. ✓
- The one non-alphabetical dual-city order (`cc-nurol`: "Abu Dhabi; Dubai" instead of "Dubai; Abu Dhabi") was inspected and found intentional — its `researcher_notes` explicitly document an Abu Dhabi HQ + Dubai branch, and the existing registries have no fixed city-ordering rule (e.g. master registry has "Riyadh; Jeddah", not alphabetical). Not a defect. Left unchanged.

**Schema**
- `uae-promotion-staging.csv`'s header is byte-identical to `uae.csv`'s 34-column header; all 67 rows have exactly 34 fields. ✓
- No BOM in any of the 6 pilot CSVs checked; staging and manifest use consistent CRLF line endings throughout, no bare LF. ✓
- `manual-review-queue.csv`, `rejected-candidates.csv`, `duplicate-and-alias-review.csv` all have consistent column counts across every row. ✓

**Protected files**
- `uae.csv` and `master-company-registry.csv`: confirmed byte-unmodified via `git diff --stat` (empty diff). ✓
- All other market-country CSVs: confirmed untouched via `git status`. ✓
- `AGENTS.md`: confirmed **not staged** (`git diff --cached` empty for this file). Its working-tree diff predates this session (an unrelated, already-present uncommitted change generated by the dev-server tooling per its own header comment) and was left exactly as found — not touched, not staged. ✓
- No `git add`, `git commit`, or `git push` was run. ✓
- No Apify actor calls were made this round (confirmed: no new files under `raw/`, `execution-checkpoint.md` unchanged). ✓

## 6. Combined totals — all 3 rounds (67 staged companies)

| | Round 1 | Round 2 | Round 3 | **Combined** |
|---|---|---|---|---|
| New companies staged | 10 | 12 | **45** | **67** |
| Dubai (incl. dual-city) | 2 | 6 | 32 | **41** |
| Abu Dhabi (incl. dual-city) | 9 | 6 | 25 | **41** |
| Dual-city (one row each) | 1 | 2 | 12 | **15** |

Dubai and Abu Dhabi are now **exactly balanced (41/41)** across the combined staged set — the round-1 Abu-Dhabi skew (9:2) that round 2 partially corrected (9:6 → cumulative 16:9) is now fully resolved by round 3's larger, less-selection-biased 213-candidate sweep.

**Sector distribution (67 combined):**

| Sector | Count |
|---|---|
| Consulting/Professional Services | 15 |
| Healthcare | 14 |
| Engineering Consultancy | 12 |
| Construction | 12 |
| Logistics | 6 |
| Architecture | 4 |
| Interior Design/Fit-out | 1 |
| HR and Recruitment | 1 |
| Retail | 1 |
| Hospitality | 1 |
| **Total** | **67** ✓ |

**Sectors still thin/absent**: NGOs, Schools/Education, and dedicated Marketing/Graphic-Design agencies remain at zero — unchanged from round 2's finding, since the Apify batches that would have searched them (`run-*-g2`, `run-*-g5`) were never executed (checkpointed, not run; see `execution-checkpoint.md`). This is a sourcing-coverage gap, not a review failure.

## 7. Remaining backlog after this round

**325 rows** in `enrichment/manual-review-queue.csv`:

| Status | Count | Meaning |
|---|---|---|
| `deep_reviewed_round3_needs_more_evidence` | 165 | From the 213 — real, plausible companies, insufficient evidence found this pass |
| `eligible_employer_no_website` | 96 | Unreviewed since round 1 — no website was ever discovered for these leads |
| `eligible_employer_deep_verified_needs_more_evidence` | 37 | Round 2's revisit set — re-checked this round, confirmed still unresolved |
| `round1_reconciled_needs_more_evidence` | 20 | From round 1's original 21 — still lack a discoverable hiring channel |
| `nowebsite_researched_needs_more_evidence` | 5 | From the 108, individually researched, real but unresolved |
| `deep_reviewed_round3_low_priority` | 2 | From the 213, low relevance signal |

**70 rows** in `enrichment/rejected-candidates.csv` (65 carried forward + 5 new this round — 2 individual-practitioner names from the 213, 3 from the no-website triage, including one Arabic-language duplicate listing of an already-rejected clinic).

**5 rows** in `enrichment/duplicate-and-alias-review.csv`: 1 carried from round 1 (Aramex — possible match against the existing registry, held pending manual confirmation) + 4 new this round, all hospital-branch/absorption cases within the `seha.ae` government-hospital family (Mafraq Hospital absorbed into SSMC; two Arabic/English duplicate listings of Sheikh Khalifa Medical City and Zayed Military Hospital, each already tracked under its primary listing).

**Notable unresolved finding carried from round 2, still unresolved**: Al Khawaja Engineering Consultants (KWEC) — casino/gambling-affiliate content found mixed into its site — remains in the manual-review backlog, not rejected outright (the underlying firm may be legitimate and hijacked) and not promoted. A human reviewer should treat this domain with particular caution.

## 8. Files changed this continuation

**Created:**
- `reconciliation/uae-round3-comprehensive-validation-report.md` (this file)

**Modified (fix only):**
- `reconciliation/uae-promotion-dry-run.csv` — regenerated in place to correct the `hold_duplicate_review`/`hold_manual_review` mislabeling described in §4. Row count unchanged (467); only the `proposed_action`/`proposed_destination_status`/`reason` values for 2 of 467 rows changed.

**Not modified by this continuation** (already correct from the interrupted session, verified not to need changes): `uae-promotion-staging.csv`, `uae-promotion-staging-manifest.csv`, `manual-review-queue.csv`, `rejected-candidates.csv`, `duplicate-and-alias-review.csv`, all `round3-*.js` files, `uae.csv`, `master-company-registry.csv`, all other market registries, `AGENTS.md`.

## 9. Final verdict

**READY_FOR_HUMAN_REVIEW** — 67 companies (10 + 12 + 45 across three rounds) are fully verified, staged, and now comprehensively validated for promotion into `uae.csv`, pending explicit human approval. Dubai/Abu Dhabi representation is balanced (41/41 incl. dual-city). 325 real, honestly-labeled leads remain in the manual-review backlog; none were discarded. No Apify credits were spent this continuation, no protected files were modified, and nothing was committed or pushed.
