# Apify UAE Pilot — Execution Checkpoint

**Executed:** 2026-09-07. **Cost ceiling approved by user (mid-session correction): $2.50 additional spend** (down from the $8.00 proposed in `cost-estimate.md`, per the user's stated Apify free-plan balance of $2.67 remaining). **Instruction:** "Prioritize the highest-value Dubai and Abu Dhabi batches first and stop automatically before exceeding $2.50. Preserve checkpoints for all unexecuted batches."

## What ran

1 negligible-cost connectivity probe ($0.0002, 0 items, nonsense search term — used only to confirm the token and corrected input schema worked before spending on real queries) + **6 of the 10 planned batches**, executed sequentially in priority order, stopping before the 7th would have been started:

| Order | run_id | City | Sector cluster | Search terms | Items | Actual cost |
|---|---|---|---|---|---|---|
| 1 | run-dubai-g3 | Dubai | Finance & Built Environment | accounting firm, construction company, logistics company | 90 | $0.4502 |
| 2 | run-abudhabi-g3 | Abu Dhabi | Finance & Built Environment | accounting firm, construction company, logistics company | 90 | $0.4502 |
| 3 | run-dubai-g4 | Dubai | Retail, Hospitality & Healthcare | retail company, hotel group, hospital | 60 | $0.3002 |
| 4 | run-abudhabi-g4 | Abu Dhabi | Retail, Hospitality & Healthcare | retail company, hotel group, hospital | 60 | $0.3002 |
| 5 | run-dubai-g1 | Dubai | Engineering & Design | engineering consultancy, architecture firm, interior design company | 90 | $0.4502 |
| 6 | run-abudhabi-g1 | Abu Dhabi | Engineering & Design | engineering consultancy, architecture firm, interior design company | 90 | $0.4502 |
| **Total** | | | | | **480** | **$2.4012** |

**Cumulative spend including the $0.0002 connectivity probe: $2.4014 — under the $2.50 cap, with $0.0986 of margin remaining** (not enough to safely start a 7th run, whose worst-observed cost this pass was $0.4502, so the 7th run was deliberately not attempted).

**Priority rationale**: batches were selected to target the largest, highest early-career-hiring-volume gaps in the existing 39-row `uae.csv` baseline — construction/logistics/accounting (§4 group 3), retail/hospitality/healthcare (§4 group 4), and engineering/architecture/interior design (§4 group 1) — each run for both Dubai and Abu Dhabi before moving to the next cluster, so both cities received identical, balanced coverage rather than fully covering one city before starting the other.

## Live actor-schema corrections made during execution (not known when `pilot-plan.md`/`cost-estimate.md` were written)

The `compass/crawler-google-places` actor's live input schema (checked 2026-09-07, at execution time) differs from what the Lebanon-era plan documented in two ways — both are cosmetic input-shape changes, not changes to what data is collected or what is disabled:
1. `scrapeSocialMediaProfiles` must now be an object of 5 per-platform booleans (`{facebooks, instagrams, youtubes, tiktoks, twitters}`, all `false`) rather than a single top-level boolean. Applied as `false` for every platform — identical intent to the Lebanon plan, just the required shape changed.
2. `website: "all"` is no longer a valid enum value; the actor now expects `"allPlaces"`. Corrected identically.

Both corrections are applied in `run-one-batch.js` (the executor script, kept in this directory for exact reproducibility) rather than by editing `proposed-apify-input.json` retroactively, so that document remains an accurate historical record of what was originally proposed and approved.

Apify also auto-capped every run's `maxTotalChargeUsd` at **$2.67278** — this is the platform's own account-balance safety limit, and it closely corroborates the user's stated "$2.67 remaining" balance independently of anything in this project.

## What did NOT run — checkpoint for the remaining 4 batches

**Not executed, and not needed for this pass's scope, but fully specified and ready to resume without any new research if additional budget is approved later:**

| run_id | City | Sector cluster | Search terms |
|---|---|---|---|
| run-dubai-g2 | Dubai | Creative & Professional Services | graphic design agency, marketing agency, HR recruitment agency |
| run-abudhabi-g2 | Abu Dhabi | Creative & Professional Services | graphic design agency, marketing agency, HR recruitment agency |
| run-dubai-g5 | Dubai | Manufacturing, Tech & Social Sector | manufacturing company, software company, NGO nonprofit organization |
| run-abudhabi-g5 | Abu Dhabi | Manufacturing, Tech & Social Sector | manufacturing company, software company, NGO nonprofit organization |

**Exact resume command** (once additional budget is approved): `node docs/job-source-discovery/pilots/apify-uae/run-one-batch.js <run_id>` for each of the 4 `run_id` values above, run one at a time so cost can be checked between runs — identical mechanism used for the 6 batches that already ran. No re-research or re-planning is needed; `proposed-apify-input.json` already fully specifies these 4 runs' inputs.

## Confirmation

No file outside `docs/job-source-discovery/pilots/apify-uae/` was touched by this execution step. `uae.csv` and `master-company-registry.csv` were not read or written by this step (normalization/dedup against them happens in the next phase, from the saved raw files only). No LinkedIn access, no personal data (reviews/images/leads/contacts/social profiles all remained disabled per `pilot-plan.md` §6, confirmed in each saved raw file's `input` object).
