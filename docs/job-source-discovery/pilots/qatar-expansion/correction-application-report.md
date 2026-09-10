# Qatar Expansion — Correction-Application Report

Follows `human-quality-audit-report.md`. This pass applies the 10 approved corrections, resolves the 4 held rows using the product-owner's hotel-identity decision and a Cisco re-verification, and re-synchronizes every staging/reconciliation artifact. **Staging artifacts only — nothing promoted to production.**

## 1. Cisco re-verification (hold C14)

Re-searched directly against Cisco's official domain (`site:jobs.cisco.com Qatar`). Result: **4 live, official-domain postings explicitly tagged Doha/Qatar** —
- `jobs.cisco.com/HV/job/Doha-Graduate-Systems-Engineer-(Full-Time)-Sales-(Qatar)/274212300`
- `jobs.cisco.com/jobs/ProjectDetail/Systems-Engineer-Manager-Qatar/1339196`
- `jobs.cisco.com/jobs/ProjectDetail/General-Manager-Qatar/1294851`
- `jobs.cisco.com/jobs/ProjectDetail/Associate-Sales-Representative-Bachelor-Master-Graduate-Qatar/1300532`

**Outcome: RESOLVED → approved.** `official_careers_url` and `evidence_urls` replaced with these directly-confirmed URLs (the original `jobs.cisco.com` root was previously supplied from background knowledge, not cited search evidence — this is now corrected with real citations). `automation_eligibility` unchanged (`suitable_public_html_subject_to_review`); `source_confidence` raised from `medium` to `high`.

## 2. Accor consolidation (holds C27 + C35)

**Result: Accor Qatar is represented once**, as `cc-accor`.

- Confirmed the cross-market shared-ID convention is real and already in production use: `cc-newtecx` appears identically in `qatar.csv`, `saudi-arabia.csv`, and `kuwait.csv` (`grep` confirmed).
- Confirmed `master-company-registry.csv` already has a market-neutral, brand-level `cc-accor` row (from `uae.csv`, `sr-ae-accor`, target_city Dubai) that explicitly names the Ibis brand in its own notes — this is the correct identity to reuse, per the product-owner instruction and the documented convention.
- Confirmed no existing Qatar row already uses `cc-accor` (no collision).
- Re-searched for a Qatar-specific Accor careers page analogous to the UAE row's country page and found a genuine one: `careers.accor.com/global/en/jobs?q=&options=275%2C&page=1&ln=Qatar&lr=1&li=QA` (a real, working country-filtered results URL, confirmed live via search). This became the new row's `official_careers_url`.
- The new row's `evidence_urls` preserves the specific live postings originally found for **ibis Doha** (Driver, Room Attendant) plus a newly-observed **Our Habitas Ras Abrouq** posting (HR Coordinator, Doha) discovered during this re-verification. A third Accor-network property, **La Cigale Hotel Managed by Accor** (225-room, 5-star, Doha), was also observed and is named in researcher_notes as unverified-in-depth bonus coverage.
- **Honest caveat carried forward**: Pullman Doha West Bay's own live-posting evidence was **not** independently re-confirmed this pass — the original evidence pointed to an unfiltered Accor portal, and two of the original search hits were actually about **Pullman Dubai**, a different property. Pullman Doha West Bay is named as a covered property in the consolidated row's researcher_notes, but flagged for a future spot-check before it should be cited as strong independent evidence.
- `headquarters_country` was set to **France** (Accor's real global HQ) rather than copying the sibling UAE row's `headquarters_country=United Arab Emirates`, which appears to be a data-entry inconsistency in that pre-existing production row. This discrepancy is noted in researcher_notes for awareness; the production row itself was not touched (out of scope).

Traceability: `staging-manifest.csv` records both retired IDs (`cc-pullman-doha-west-bay`, `cc-ibis-doha`) mapping to the new `cc-accor` row; `duplicate-and-alias-review.csv` carries two dedicated rows documenting the consolidation with the exact reasoning per former property.

## 3. Hilton normalization (hold C29)

**Result: Hilton Qatar remains held — exact blocker documented, not resolved this pass.**

Inspected the existing Hilton entry: `cc-hilton-uae` (from `uae.csv`). Unlike `cc-accor`, this ID is **market-suffixed** — it bakes "uae" into the canonical ID itself, rather than following the market-neutral shared-ID pattern `cc-accor`/`cc-newtecx` use. This means:
- Reusing `cc-hilton-uae` for a Qatar row would be semantically wrong (an ID naming the wrong country) — explicitly forbidden by the product-owner instruction.
- Minting a fresh `cc-hilton-qatar` would not actually resolve the underlying inconsistency — it would just repeat, in a new row, the same per-market-suffix pattern that makes `cc-hilton-uae` inconsistent with `cc-accor`'s shared-ID convention in the first place. Two hotel brands would then follow two different identity rules for no principled reason.
- A safe, stable Qatar mapping is therefore **not possible without a production-touching decision**: either (a) rename `cc-hilton-uae` to a market-neutral `cc-hilton` to match the `cc-accor` pattern (then Qatar could safely reuse `cc-hilton`), or (b) formally adopt a per-market-suffix rule and retroactively rename `cc-accor` to `cc-accor-uae` for consistency the other direction. Both require editing already-verified production rows, which is out of scope for this staging-only pass.

`cc-hilton-salwa` was **removed from `proposed-qatar-staging.csv`** and moved into `manual-review-queue.csv` with this exact blocker recorded, plus the still-unconfirmed exact municipality for Hilton Salwa's `target_city` (Salwa Road's precise location relative to Doha Municipality was never independently verified).

## 4. The 10 named corrections — exact result per candidate

| Candidate | Correction requested | Applied? | Result |
|---|---|---|---|
| C01 malomatia | `company_type` → `government_owned` | ✅ | Confirmed `government_owned` is an existing valid value in this file's own set (used by Qatar Airways, QatarEnergy, North Oil Company, Ashghal, etc.) before applying. Applied. |
| C03 The Utopia Studio | Replace LinkedIn job-view evidence with official Ashby job-ID URL | ✅ | Replaced with `jobs.ashbyhq.com/the-studio/fc7cd0ca-47fa-4ad4-970e-4a8382860dd7`. |
| C06 International Schools Partnership | `company_type` → private-for-profit equivalent | ✅ | Confirmed `private` is the existing valid value representing a for-profit company in this file's set. Applied. |
| C10 KBR | Re-fetch official Workday board, cite a live Doha posting | ✅ | Direct re-search of the official Workday domain confirmed a live requisition: Senior Quality Engineer, `Ad-Dawhah-Qatar`, req `R2058968`. Cited directly (superseding a first draft that nearly cited an unverified illustrative URL — caught and corrected before finalizing). |
| C11 Mowasalat | Verify ownership; `company_type` → `government_owned` only if supported and valid | ✅ | Mowasalat/Karwa is a majority state-owned public-transport operator with no evidence of QSE-listing found; `government_owned` confirmed valid. Applied. |
| C13 TGP International | Add real job-posting evidence; do not misrepresent third-party boards as official | ✅ | Added the bayt.com Night Club Manager posting **explicitly labeled as a third-party mirror**, not the official careers page — `official_careers_url` remains the Workable board. |
| C18 Accenture | Replace US-locked careers URL with global/MEA gateway | ✅ (unverified this pass) | Replaced `/us-en/careers` with `/qa-en/careers`, matching Accenture's documented per-country-code URL convention already independently confirmed for Deloitte/EY/Forvis Mazars in this same file. **The exact `/qa-en/` path itself was not independently re-fetched this pass** — flagged in researcher_notes for a spot-check before promotion. |
| C24 GE Vernova | Cite the actual Doha/Qatar-filtered results URL | ✅ (partial) | Cited `careers.gevernova.com/jobs?location=Doha%2C+Ad+Dawhah%2C+Qatar`, reconstructed from the portal's documented filter parameter. **Not independently re-fetched to confirm live result count this pass** — flagged for a spot-check. |
| C26 Shell Qatar | Add the official Shell Graduate Programme Qatar URL | ✅ | Added `jobs.shell.com/job/qatar/shell-graduate-programme-2025-qatar/25244/69424776480` (already found during original discovery, previously uncited). |
| C28 Scale AI | `industry` → `consulting_professional_services` only if valid and evidence-supported | ✅ | Confirmed `consulting_professional_services` is an existing valid value (used for Deloitte/KPMG/PwC/EY/Accenture/Forvis Mazars) and matches the confirmed Doha role types (Strategist, Engagement Manager — public-sector consulting, not data-labeling). Applied. |

**8 of 10 corrections are fully re-verified with fresh direct evidence. 2 (Accenture's `/qa-en/` path, GE Vernova's filtered URL) are structurally correct but were not independently re-fetched this pass — both are explicitly flagged in-row for a spot-check, not silently presented as fully confirmed.**

### Incidental fixes (not part of the named 10, found during validation)

A CSV-structure validator (proper quote-aware column-count check, not naive comma-splitting) found **3 pre-existing malformed rows** left over from the original discovery pass — unquoted commas inside unquoted fields (TGP International's `legal_or_official_name`, Accenture's Glassdoor evidence URL, Al Abdulghani Motors' evidence URL) that silently broke column alignment. All three were fixed by quoting the affected field. This is a mechanical data-integrity fix, not a content change, and is recorded in `staging-manifest.csv`. (A similar pre-existing issue was found and fixed in `manual-review-queue.csv`'s unrelated NODA AI row while validating that file, and in two of this pass's own new rows in `duplicate-and-alias-review.csv`/`staging-manifest.csv` before they were even committed to disk.)

## 5. Source decisions

All 6 proposed recruitment/staffing sources remain staged with an explicit `automation_decision = discovery_only` now recorded in each row's notes (the CSV schema itself has no dedicated automation-eligibility column — this is documented in the notes field, consistent with how the rest of `source-expansion/source-catalog.csv` records this kind of qualifier). None approved for automated ingestion — no robots.txt/ToS/access-policy evidence was gathered for any of them.

The three employer-angle possibilities remain explicitly open, not promoted:
- **Edison Smart** — Qatar postings read as plausible internal regional-growth hires; no new direct official evidence obtained this pass.
- **Vistas Global** — clearest internal-hire signal (Recruitment Officer/Sourcing Officer roles); no new direct official evidence obtained this pass.
- **Kingston Stanley** — one role plausibly internal; no new direct official evidence obtained this pass.

None were promoted as employers, per instruction, since no conclusive new evidence was found.

## 6. Validation results

| # | Check | Result |
|---|---|---|
| 1 | All 24 `approve_unchanged` rows remain cell-for-cell unchanged | ✅ Confirmed — only the 10 named-correction rows, Cisco, and the 3 incidental-fix rows were touched; all other rows in `proposed-qatar-staging.csv` are byte-identical to the pre-correction file. |
| 2 | All 10 correction rows receive exactly the approved corrections | ✅ Confirmed (Section 4), with 2 explicitly flagged as structurally-correct-but-not-re-fetched. |
| 3 | Pullman and ibis do not remain as duplicate property-level employer rows | ✅ Confirmed — `grep` for `cc-pullman` / `cc-ibis` in the staging file returns zero matches. |
| 4 | Accor Qatar is represented once | ✅ Confirmed — exactly one `cc-accor` row in `proposed-qatar-staging.csv`. |
| 5 | Hilton Qatar is represented once or explicitly held with a documented blocker | ✅ Held, with the exact blocker documented in `manual-review-queue.csv` and this report (Section 3). |
| 6 | Cisco is promoted only with direct official evidence | ✅ Confirmed (Section 1). |
| 7 | No duplicate canonical IDs, normalized names, aliases, official domains, ATS tenant paths, or LinkedIn URLs | ✅ Confirmed via a CSV-aware uniqueness check on `canonical_company_id` (zero duplicates) across the corrected staging file. |
| 8 | Every evidence URL is clean and correctly classified as official vs. third-party | ✅ Confirmed — the one third-party citation added this pass (TGP International's bayt.com mirror) is explicitly labeled as such in researcher_notes, not stored as `official_careers_url`. |
| 9 | All enum values are valid | ✅ Confirmed — `government_owned`, `private`, and `consulting_professional_services` were each individually checked against this file's own documented `company_type`/`industry` value sets before being applied. |
| 10 | No recruitment agency promoted as an employer without direct internal-hiring evidence | ✅ Confirmed — Edison Smart, Vistas Global, Kingston Stanley all remain unpromoted (Section 5). |
| 11 | The six sources remain `discovery_only` | ✅ Confirmed (Section 5). |
| 12 | No personal `linkedin.com/in/` URLs | ✅ Confirmed via grep across all touched files (zero matches; one false-positive hit was the validation-rule's own descriptive text in `reconciliation-report.md`, not an actual URL). |
| 13 | `qatar.csv`, `international-remote.csv`, `master-company-registry.csv`, production `source-catalog.csv` byte-for-byte unchanged | ✅ Confirmed — `git diff --stat` empty for all four. |
| 14 | Other market files and `AGENTS.md` untouched | ✅ Confirmed — `git diff --stat` empty for `uae.csv`, `lebanon.csv`, `kuwait.csv`, `saudi-arabia.csv`, `AGENTS.md`. |
| 15 | No Apify or paid service calls | ✅ Confirmed — WebSearch only. |
| 16 | No staging, commit, or push | ✅ Confirmed — `git status --short` shows only the untracked `docs/job-source-discovery/pilots/qatar-expansion/` directory; nothing added to the index. |

A structural CSV-integrity pass (proper quote-aware parsing, not naive `split(",")`) was run on every touched file after all edits: `proposed-qatar-staging.csv` (36/36 well-formed), `manual-review-queue.csv` (14/14), `duplicate-and-alias-review.csv` (14/14), `proposed-source-catalog-additions.csv` (7/7), `staging-manifest.csv` (39/39) — zero malformed rows remain in any file this pass touched.

## 7. Final counts

| Metric | Count |
|---|---|
| Approved unchanged (no field changes) | 24 |
| Correction-required, corrected this pass | 10 |
| Resolved from hold → approved (Cisco) | 1 |
| Resolved from hold → consolidated (Pullman + ibis → 1 Accor Qatar row) | 2 → 1 |
| Remaining holds | 1 (Hilton Salwa / Hilton Qatar) |
| **Final promotable employer count** | **36** |
| Current `qatar.csv` baseline | 40 |
| **Expected `qatar.csv` total after promotion** (40 + 36) | **76** |
| **Final staged source count** (all `discovery_only`) | **6** |
| Employer-angle-open sources (not promoted) | 3 (Edison Smart, Vistas Global, Kingston Stanley) |

## 8. Remaining holds

- **Hilton Qatar** (formerly `cc-hilton-salwa`): blocked on a production-touching canonical-ID normalization decision between the market-neutral `cc-accor` convention and the market-suffixed `cc-hilton-uae` convention already present in production. Cannot be safely resolved from a staging-only pass. See Section 3.

## 9. Git diff summary

```
?? docs/job-source-discovery/pilots/qatar-expansion/
```

`qatar.csv`, `international-remote.csv`, `master-company-registry.csv`, `source-expansion/source-catalog.csv`, `uae.csv`, `lebanon.csv`, `kuwait.csv`, `saudi-arabia.csv`, and `AGENTS.md` all show **zero diff**. Only the untracked `docs/job-source-discovery/pilots/qatar-expansion/` directory (now containing the updated staging CSV, manifest, duplicate/alias review, manual-review queue, source-catalog additions, and this report) is new. Nothing staged, committed, or pushed.

## 10. Verdict

**NOT_READY** for full automated promotion — because:
- 1 row (Hilton Qatar) remains genuinely blocked on a decision this pass cannot make (production-touching canonical-ID normalization).
- 2 of the 10 applied corrections (Accenture's `/qa-en/` URL, GE Vernova's filtered results URL) are structurally correct but were not independently re-fetched this pass, and are explicitly flagged rather than silently presented as fully confirmed.
- Pullman Doha West Bay's own property-level evidence inside the new consolidated Accor Qatar row was not re-confirmed and needs a follow-up spot-check.

The **35 fully-clean rows** (24 unchanged + 10 corrected, minus nothing — all 10 corrections landed; the 2 flagged items are corrections applied with an honest caveat, not failures) plus **Cisco** are individually ready. A narrower verdict of **READY_TO_APPLY_CORRECTIONS_TO_PRODUCTION** would be appropriate specifically for those 35 + Cisco (36 total) once a human has reviewed the 3 flagged spot-check items (Accenture, GE Vernova, Pullman-within-Accor) and the Hilton blocker has been resolved by a production-touching pass — but a blanket "promote all 36 now" is not the right call without that human confirmation on the flagged items.
