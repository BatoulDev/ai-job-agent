# UAE Registry Expansion — Deterministic Triage + Deep Verification (Round 2)

**Date:** 2026-09-07 (continuation of the same-day pilot). **No Apify calls made this round — pure re-analysis of the 392-row manual-review backlog plus direct WebFetch verification.**
**Status: 12 additional companies staged (22 total across both rounds). `uae.csv` and `master-company-registry.csv` remain unmodified.**
**Verdict: READY_FOR_HUMAN_REVIEW**

---

## 1. Triage totals across all 392 leads

| Bucket | Count |
|---|---|
| high_priority_verification | 181 |
| medium_priority_backlog | 162 |
| low_priority | 45 |
| reject | 4 |
| **Total** | **392** ✓ |

**Hard rejects (4):** all four were individual-practitioner name patterns that had slipped through the round-1 category filter (`Dr AK Health Care Medical Center L.L.C`, `Dr. Nima.Yeganeh`, `Dr. Mulham Polyclinic`, `Dr Layla Clinique`) — caught this round by a name-pattern rule (`/^(Dr\.?|Mr\.?|...)\s/i`), not a category rule, since their Google category ("Medical Center"/"Hospital"/"Medical clinic") looked employer-like but the name itself is a personal practice.

## 2. Scoring method (deterministic, reproducible — `enrichment/triage.js`)

Each of the 392 leads was joined against `all-classified-candidates.csv` (for `regions`, `rating`, `reviews_count`, `duplicate_count`, full `categories`) and `enriched-company-candidates.csv` (for the 21 rows already directly verified in round 1). A single numeric score (0–100) was computed from:

| Signal | Weight | Basis |
|---|---|---|
| Domain quality | 0–25 | `.ae` domain = 25; other real domain = 15; weak platform (Instagram/Wix/Google-Business-Site/etc.) = 5; no website = 0 |
| Dubai/Abu Dhabi location confidence | 0–10 | From the `regions` field (derived from which Apify run produced the record — reliable, unlike Google's own often-empty `city` field), not 0/10 for anything outside the two target cities |
| Sector priority | 8–25 | Highest (25) for Engineering/Architecture/Construction/HR/NGO/Schools; 22 for Accounting/Healthcare/Marketing; 18 for Interior Design/Real Estate (secondary); 12 for Logistics (secondary); 8 otherwise — directly encodes the user's explicit extra-priority sector list |
| Business scale/permanence | 0–20 | From Google reviews count (0/4/9/14/18 tiers) + a rating bonus (+1/+2) — a proxy for how established and how likely to have real hiring volume |
| Duplicate/branch adjustment | −10 to +5 | −10 if the name carries a branch qualifier (e.g. "- Karama", "Branch"); +5 if the same domain was corroborated across ≥2 independent search hits |
| Identity-clarity penalty | −10 to 0 | Generic 1–2 word names with no company-type signal word, paired with a generic category |
| Prior-enrichment bonus | 0–15 | +15 if round 1 already confirmed the official domain directly; +5 if round 1 hit only a technical block (worth a retry) — this is why the round-1 `needs_manual_review` rows cluster at the top of the ranking |

**Hard-reject rules** (bypass scoring entirely): individual/practitioner name pattern; regions outside Dubai/Abu Dhabi.
**Bucket thresholds:** reject <15 or hard-reject; low_priority 15–34; medium_priority_backlog 35–54; high_priority_verification ≥55.

Full per-row output: `enrichment/triage-scored-candidates.csv` (392 rows, score + every component + rationale).

## 3. Selecting the 50 for deep verification

The 21 rows already directly verified in round 1 (`already_enriched=yes`) were excluded from the "net-new" pool — re-fetching them would repeat known work. That left **161 net-new high-priority candidates** (73 Dubai, 88 Abu Dhabi) across 5 primary sectors (Construction, Engineering, Architecture, Accounting/Audit, Healthcare — the only sectors this candidate pool actually contains, since the Apify batches covering HR/Marketing/NGOs/Schools were never executed, see round-1 checkpoint).

A per-(sector × city) cell selection was used, capped at 5–6 per cell, **with an explicit +1 tilt toward Dubai** in three cells (Construction, Architecture, Engineering) per the user's instruction to correct the round-1 Abu-Dhabi skew:

| Cell | Target | Cell | Target |
|---|---|---|---|
| Construction — Dubai | 6 | Healthcare — Abu Dhabi | 5 |
| Architecture — Dubai | 6 | Construction — Abu Dhabi | 5 |
| Engineering — Dubai | 6 | Engineering — Abu Dhabi | 5 |
| Accounting/Audit — Dubai | 5 | Accounting/Audit — Abu Dhabi | 5 |
| Healthcare — Dubai | 5 | Architecture — Abu Dhabi | 2 (only 2 available in the pool) |

**Result: 50 candidates, 28 Dubai / 22 Abu Dhabi** — full list in `enrichment/selected-50-for-deep-verification.csv`.

## 4. Deep verification method and results

Every one of the 50 was directly WebFetched against its own official domain (never a search snippet, aggregator, or LinkedIn) — no Apify, no LinkedIn scraping. LinkedIn company pages (never personal `/in/` profiles) were noted only as supporting identity evidence where the company self-referenced one. Full detail: `enrichment/deep-verification-50.csv`.

| Classification | Count |
|---|---|
| `new_verified` | **12** |
| `needs_more_evidence` | 37 |
| `rejected` | 1 |
| **Total** | **50** ✓ |

**The 1 rejected:** "Ultra Care Medical Group" — its only web presence was a `business.google.com` mini-site URL, which now returns HTTP 404. No working official domain exists.

**Notable findings among the 37 `needs_more_evidence`:**
- **A likely compromised/hijacked site**: Al Khawaja Engineering Consultants (KWEC)'s page returned unrelated casino/gambling affiliate content mixed into otherwise-legitimate firm content — flagged explicitly as a real concern, not ignored.
- **An unresolved LinkedIn-identity mismatch**: Beverly Hills Specialty Hospital's self-referenced LinkedIn slug (`bhmc-uae`) doesn't match its own name (`BHSH`) — flagged, not assumed to match.
- **A domain-quality red flag on a claimed-established firm**: "Next Architects" claims operation since 2010 but is hosted on a personal `vercel.app` subdomain rather than a custom domain — downgraded accordingly rather than taken at face value.
- **The SEHA government hospital network blocked again** (Central Hospital, via the same `seha.ae` domain) — now confirmed blocked across 4 separate facilities/passes, a systemic access issue rather than an isolated one.
- Several personal-LinkedIn-only findings (Vitruvius, HDR Architects) — correctly not used as company evidence per policy.

## 5. The 12 new companies added to staging

| canonical_company_id | Company | City | Industry | Careers evidence |
|---|---|---|---|---|
| cc-assist-plus | Assist Plus | Abu Dhabi | Consulting/Professional Services (Accounting) | Dedicated careers page |
| cc-darji-accounting | Darji Accounting | Dubai | Consulting/Professional Services (Accounting) | Dedicated careers page |
| cc-bericht-audit-advisory | Bericht Audit & Advisory | **Dubai; Abu Dhabi** | Consulting/Professional Services (Audit) | Dedicated careers page |
| cc-chawla-architectural-consulting-engineers | Chawla Architectural & Consulting Engineers | Dubai | Architecture | Careers nav link (48-year-old firm) |
| cc-civilco | Civilco | Abu Dhabi | Construction | Vacancies/Apply Form pages; **4,000+ staff claimed** |
| cc-silver-coast-construction-boring | Silver Coast Construction & Boring | **Dubai; Abu Dhabi** | Construction | Dedicated careers page; ~2,550 employees claimed |
| cc-at-group-interiors | A&T Group Interiors | Dubai | Construction (Interiors) | Dedicated careers page |
| cc-mwazinoon-engineering-consultancy | Mwazinoon Engineering Consultancy | Abu Dhabi | Engineering Consultancy | Dedicated recruitment page |
| cc-datum-engineering-consultants | Datum Engineering Consultants | Dubai | Engineering Consultancy | Careers nav link |
| cc-mediclinic-al-mamora | Mediclinic Al Mamora | Abu Dhabi | Healthcare | **Central Mediclinic Middle East ATS portal** |
| cc-international-knee-joint-centre | International Knee & Joint Centre | Abu Dhabi | Healthcare | Dedicated careers page |
| cc-international-modern-hospital | International Modern Hospital (IMH) | Dubai | Healthcare | Dedicated careers page; 117+ beds |

## 6. Dubai vs. Abu Dhabi — combined total (both rounds)

| | Round 1 (10) | Round 2 (12) | **Combined (22)** |
|---|---|---|---|
| Dubai (incl. dual-city) | 2 | 6 (+3 dual) | **9** |
| Abu Dhabi (incl. dual-city) | 9 | 6 (+3 dual) | **16** |
| Dual-city (one row, not duplicated) | 1 | 2 | **3** |

Dubai's share rose from 20% (2/10) after round 1 to **41% (9/22)** combined — a real, meaningful correction, though Abu Dhabi remains ahead. This reflects what the actual underlying candidate pool contains (see §3 — the pool itself is Abu-Dhabi-skewed in Healthcare specifically because Mediclinic, NMC, and several major hospital groups happen to have stronger Abu Dhabi web presences in this sample), not a residual selection bias — the selection step itself was deliberately tilted toward Dubai.

## 7. Sector distribution (combined 22)

Healthcare (8) · Consulting/Professional Services / Accounting (4) · Construction (3) · Engineering Consultancy (3) · Architecture (2) · Interior Design/Fit-out (1) · HR and Recruitment (1).

**Sectors the user asked to prioritize that remain absent or thin**: NGOs, Schools/Education, and dedicated Marketing/Graphic-Design agencies have **zero** representation in either round's staged set. This is not a selection failure — the underlying Apify candidate pool contains **no companies in these categories at all**, because the two batches that would have searched them (`run-*-g2`: graphic design/marketing/HR, and `run-*-g5`: manufacturing/software/NGOs) were never executed (checkpointed, not run, per the user's "do not rerun Apify" instruction this round). HR/Recruitment has exactly one representative (Sundus, from round 1, found via cross-category Google Maps noise rather than a dedicated HR search).

## 8. Duplicate/branch findings

- **Zero domain collisions** found between the 12 new companies and: the existing 39-row `uae.csv`, the 288-row `master-company-registry.csv`, or the 10 round-1-staged companies (checked programmatically).
- **One name-correction, not a duplicate**: the Google Maps listing label "IMH Corporate Office" was corrected to the company's actual name, "International Modern Hospital (IMH)", confirmed on its own site — filed as one company, not two.
- **Two dual-city companies** (Bericht Audit & Advisory, Silver Coast Construction & Boring) confirmed via their own sites to operate in both Dubai and Abu Dhabi — filed as one canonical row each with `target_city = "Dubai; Abu Dhabi"`, not duplicated, consistent with the task's explicit branch-collapsing rule.
- **One flagged-but-unresolved group-structure note**: Assist Plus discloses it is "An Assist Plus Group Company" with separate subsidiaries — noted in `researcher_notes` for a human reviewer, not treated as a duplicate or blocker since Assist Plus itself is the entity with the confirmed careers page.
- No branch-qualifier names (e.g. "- Karama", "Branch") appeared among the 12 promoted rows — all such candidates were either scored down during triage or excluded during deep verification.

## 9. Updated total staged companies

**22** (10 from round 1 + 12 from round 2), all in `reconciliation/uae-promotion-staging.csv` with a full traceability manifest in `reconciliation/uae-promotion-staging-manifest.csv`. None of the original 10 were removed, altered, or found to have an identity/duplicate/evidence problem during this round's review.

## 10. Remaining manual-review backlog

**379 rows** in `enrichment/manual-review-queue.csv` (was 392; −50 reviewed this round, +37 returned as `needs_more_evidence`), broken down exactly as:
- **213** `eligible_employer` — not yet individually reviewed (263 from round 1, minus the 50 selected into this round's deep-verification pass)
- **108** `eligible_employer_no_website` — unchanged from round 1, not touched this round
- **37** `eligible_employer_deep_verified_needs_more_evidence` — this round's real, confirmed-legitimate companies lacking a discoverable hiring channel, or blocked by a technical issue
- **21** `eligible_employer_enriched_but_unresolved` — unchanged from round 1

The full triage scores (`triage-scored-candidates.csv`) let a future pass resume directly from the next-highest-ranked unreviewed candidates without re-scoring anything.

## 11. Files changed this round

**Created**, all under `docs/job-source-discovery/pilots/apify-uae/`:
- `enrichment/triage.js`, `enrichment/triage-scored-candidates.csv`
- `enrichment/select-50.js`, `enrichment/selected-50-for-deep-verification.csv`
- `enrichment/build-deep-verification-50.js`, `enrichment/deep-verification-50.csv`
- `enrichment/apply-deep-verification-updates.js`
- `reconciliation/build-staging-round2.js`
- `reconciliation/uae-triage-and-deep-verification-report.md` (this file)

**Modified** (all within the same pilot directory, no production files touched):
- `enrichment/manual-review-queue.csv` (392 → 379 rows)
- `enrichment/rejected-candidates.csv` (64 → 65 rows)
- `enrichment/enriched-company-candidates.csv` (33 → 45 rows)
- `reconciliation/uae-promotion-staging.csv` (10 → 22 rows)
- `reconciliation/uae-promotion-staging-manifest.csv` (10 → 22 rows)

**Not modified:** `uae.csv`, `master-company-registry.csv`, all other market-country CSVs, `AGENTS.md`, application code, database migrations, n8n workflows. No Apify calls, no LinkedIn scraping, no git staging/commit/push.

## 12. Validation results

- Full 392-row triage is exhaustive and reproducible from `all-classified-candidates.csv` + `enriched-company-candidates.csv` (pure functions, no randomness).
- Full 467-candidate pool accounts exactly across all four terminal buckets: 379 (manual-review) + 65 (rejected) + 22 (staged) + 1 (duplicate-review) = **467** ✓.
- All 22 staged rows: 34-column schema match confirmed, canonical IDs and source_record_ids unique among themselves, zero normalized-domain collisions across the entire staged set, all `evidence_urls` non-empty, zero personal `linkedin.com/in/` URLs anywhere in staged output.
- Zero collisions between any of the 22 staged rows and the existing 39-row `uae.csv` + 288-row `master-company-registry.csv` (checked programmatically by canonical ID and normalized domain).
- `uae.csv`, `master-company-registry.csv`, other market files, and `AGENTS.md` confirmed unmodified via `git status`/`git diff`.

## 13. Final verdict

**READY_FOR_HUMAN_REVIEW** — 22 companies (10 from round 1 + 12 from round 2) are fully verified, staged, and validated for promotion into `uae.csv` pending explicit human approval. This round performed no Apify calls and spent no additional Apify credits, per the user's explicit instruction. 379 real, honestly-labeled leads remain in the manual-review backlog, fully re-prioritized and ready for a future pass to resume from exactly where this one stopped.
