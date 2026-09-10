# Blocking Integrity Check — UAE 149-vs-110 Discrepancy

Triggered by a user-flagged count discrepancy before commit. **Investigated and resolved before any commit was made.**

## 1. Exact verified counts (quote-aware CSV parser)

A proper CSV parser (handles quoted fields, embedded commas/newlines, doubled-quote escaping — not naive `split(",")`) was run against `uae.csv` from four references:

| Reference | Physical non-empty lines | Header cols | **CSV data rows (excl. header)** | Unique `canonical_company_id` | Malformed rows | Duplicate IDs |
|---|---|---|---|---|---|---|
| Working tree (after this pass's Hilton edit) | 150 | 34 | **149** | 149 | 0 | 0 |
| `git HEAD` | 150 | 34 | **149** | 149 | 0 | 0 |
| `origin/main` | 150 | 34 | **149** | 149 | 0 | 0 |
| Commit `6137c16570d6050afa9f4271b507e43bb89ab45f` | 150 | 34 | **149** | 149 | 0 | 0 |

**All four references agree: 149 data rows.** There is no data loss and no version-skew — the working tree, HEAD, origin/main, and the exact UAE-completion commit are all consistent.

## 2. Explanation of the 149-vs-110 discrepancy

**Root cause: a reporting error in the prior turn's report, not a data-integrity problem.**

`commit 6137c16570d6050afa9f4271b507e43bb89ab45f`'s own commit message states explicitly:

```
feat(job-sources): expand verified UAE employer registry

- uae.csv: 39 -> 149 rows (110 net-new verified employers)
- master-company-registry.csv: 288 -> 398 rows, synced from uae.csv
- source-catalog.csv: 89 -> 107 rows (18 new UAE/discovery-batch sources)
```

`uae.csv` already existed with 39 rows before this commit (created earlier, in commit `a3a54a0`). Commit `6137c16` **added 110 new rows** to it, bringing the total to 149 (39 + 110 = 149). `git show --stat 6137c16 -- uae.csv` confirms this exactly:

```
 docs/job-source-discovery/uae.csv | 110 ++++++++++++++++++++++++++++++++++++++
 1 file changed, 110 insertions(+)
```

Earlier in this session, right after `git checkout main && git pull --ff-only` fast-forwarded onto this commit, the fast-forward's own diffstat displayed this same `uae.csv | 110 +` line (a *delta* count — lines added by that specific commit range) but it was **misread as an absolute row total** and carried forward into the Qatar final-verification report as "uae.csv = 110 rows (unchanged)". This was a misinterpretation of a diffstat delta as a file total, not an actual truncation or overwrite of `uae.csv` — the file's real content was never at 110 rows at any point relevant to this work; it went from 39 (pre-existing) to 149 (post-6137c16) in a single commit, and has stayed at 149 ever since, including throughout every edit made in this Qatar-expansion branch.

`master-company-registry.csv = 398` at the point I read it (before my Qatar promotion) is **also fully consistent** with the completed UAE work — the commit message confirms `master-company-registry.csv: 288 -> 398 rows, synced from uae.csv` in that same commit, i.e. 398 was already the correct post-UAE-completion baseline, not a sign that UAE was missing.

## 3. Confirmation: all 149 UAE employers present

Canonical-ID set comparison between commit `6137c16` (the completed UAE baseline) and the current working tree:

| | Count |
|---|---|
| IDs in baseline (`6137c16`) | 149 |
| IDs in current working tree | 149 |
| **IDs missing** (present in baseline, gone now) | **1** — `cc-hilton-uae` |
| **IDs unexpectedly added** (in working tree, not in baseline) | **1** — `cc-hilton` |

`cc-hilton-uae` is not actually "missing" — it is the same row, same company, same every other field, with its `canonical_company_id` renamed to `cc-hilton` (the approved normalization). All other 148 UAE employers are present with unchanged IDs.

## 4. Verification: the only intentional UAE change

`git diff -- docs/job-source-discovery/uae.csv` (full diff, not just `--stat`) shows exactly:

```
1 file changed, 1 insertion(+), 1 deletion(-)
```

One line removed (`cc-hilton-uae,sr-ae-hilton-uae,Hilton,...`), one line added (`cc-hilton,sr-ae-hilton-uae,Hilton,...`) — every other field on that row identical except a traceability note appended to `researcher_notes`. **No other line in the 150-line file was touched.** No UAE company was deleted, added, or otherwise modified. This was independently re-confirmed as part of this integrity check (not merely inherited from the prior pass's claim).

## 5. Re-run Qatar validations

| Check | Result |
|---|---|
| `qatar.csv` = 77 data rows | ✅ 77 (quote-aware parser, 0 malformed rows, 77 unique IDs, 0 duplicates) |
| `master-company-registry.csv` = 435 data rows | ✅ 435 (0 malformed rows) |
| `source-catalog.csv` = 113 data rows | ✅ 113 (0 malformed rows, 113 unique IDs, 0 duplicates) |
| 37 Qatar employers added exactly once | ✅ `qatar.csv` 40→77 is a pure 37-row append (`git diff`: 37 insertions, 0 deletions) |
| 6 `discovery_only` sources added exactly once | ✅ `source-catalog.csv` 107→113 is a pure 6-row append; all 6 new rows contain the literal string `automation_decision = discovery_only` |
| No duplicate canonical IDs | ⚠️→✅ **Naive per-file ID uniqueness initially flagged 15 "duplicates"** in `master-company-registry.csv` (`cc-ey` ×5, `cc-pwc` ×4, `cc-deloitte` ×4, `cc-kpmg` ×5, `cc-people365` ×3, `cc-netways` ×4, `cc-tabby` ×2, `cc-zain` ×2, `cc-careem` ×2, `cc-al-tamimi-company` ×2). **Investigated individually**: every one of these is a legitimate, pre-existing multi-market employer (e.g. PwC/Deloitte/KPMG/EY appear once each in Lebanon, Saudi Arabia, Qatar, Kuwait, and/or UAE) — each occurrence has a **distinct** `target_country`. This is the documented cross-market canonical-ID-reuse convention already established in this registry (the same pattern `cc-hilton` and `cc-accor` now also follow), not a data-quality defect. |
| No duplicate `(canonical_id, target_country)` pairs | ✅ **0** across all 435 rows, confirmed with a proper composite-key check. `cc-hilton` → exactly `[United Arab Emirates, Qatar]`; `cc-accor` → exactly `[United Arab Emirates, Qatar]`. No pair repeats. |
| No unrelated market data changed | ✅ `git diff --stat` empty for `international-remote.csv`, `lebanon.csv`, `kuwait.csv`, `saudi-arabia.csv`, `AGENTS.md`. |

## 6. Decision

**Not a truncation. Not a deletion. A reporting error, now corrected.** All 149 UAE employers are intact; the only change is the approved `cc-hilton-uae` → `cc-hilton` normalization. The Qatar promotion (77/435/113) is independently confirmed correct. Proceeding to correct the final report, run required quality checks, and commit.
