// LinkedIn/Bebity DISCOVERY seed list — separate and independent from
// linkedinEnrichment.ts/applyLinkedInEnrichmentBatch.ts, which are
// Data-Slayer ENRICHMENT ONLY and never discover anything (confirmed by
// Data-Slayer's own real input schema: job_ids_or_urls + include_hiring_team
// only, no keyword/location field of any kind). This module is the
// discovery counterpart Bebity itself was always meant for, per
// providerConfig.ts's own LinkedIn entry (bebity/linkedin-jobs-scraper).
//
// Mirrors apifyMultiCompanySourceSeeds' static-seed shape in
// ai-job-agent-01-job-ingestion.ts (Bayt/GulfTalent/Indeed) — same
// per-market actor_url/request_body/refresh_scope/max_jobs_per_run/
// max_total_charge_usd fields, same reasoning. Deliberately NOT a dynamic
// per-request computation: these are static, reviewed, bounded values,
// same as every other Apify seed in this codebase.
//
// Gated by isProviderEnabled("linkedin") exactly like
// findEligibleLinkedInEnrichmentJobs.ts's own caller
// (list-linkedin-enrichment-queue/route.ts) already is — returns an empty
// list while providerConfig.ts's linkedin.enabled stays false, so the n8n
// discovery branch's loop has zero items to iterate and the paid Bebity
// actor call can never fire in that state, regardless of whether the
// workflow itself is executed. This is the real safety mechanism (not
// "do not execute the workflow" alone) that keeps this branch structurally
// inert until a human explicitly flips enabled:true (AGENTS.md §35 rule 10).
import { isProviderEnabled } from "./providerConfig.ts";

export interface LinkedInDiscoverySeed {
  market: string;
  actorUrl: string;
  requestBody: {
    rows: number;
    locations: string[];
    companyProfile: false;
    enrichCompany: false;
  };
  refreshScope: string;
  maxJobsPerRun: number;
  maxTotalChargeUsd: number;
}

const BEBITY_ACTOR_URL = "https://api.apify.com/v2/acts/bebity~linkedin-jobs-scraper/run-sync-get-dataset-items";

// Real, fresh-reconfirmed pricing (free metadata GET, this phase):
// PAY_PER_EVENT, apify-actor-start=$0.00005 one-time, apify-default-
// dataset-item FREE tier=$0.0015/job (worst-case tier, used here since the
// account's real tier is not assumed). maxTotalChargeUsd below =
// actorStart + rows * perItem for each seed's own rows value — same
// "exact worst-case, no arbitrary buffer" discipline already used for
// Call Apify Actor's own cost caps.
const BEBITY_ACTOR_START_USD = 0.00005;
const BEBITY_PER_ITEM_USD = 0.0015;

function computeMaxTotalChargeUsd(rows: number): number {
  return Math.round((BEBITY_ACTOR_START_USD + rows * BEBITY_PER_ITEM_USD) * 1_000_000) / 1_000_000;
}

// rows:10 uniformly across every market for this first implementation —
// deliberately conservative (AGENTS.md §35 "small bounded batches first"):
// Lebanon has real prior evidence at rows:10 and rows:30 (both live-
// verified), but the other four markets have NEVER been tested with
// Bebity at all ("whether this actor's locations field even resolves Gulf
// markets correctly has never been tested" — providerConfig.ts's own
// LinkedIn comment) — starting every market at the same small, already-
// proven-for-Lebanon size keeps this symmetric and avoids assuming
// untested Gulf behavior matches Lebanon's. Raise only with real evidence,
// same as every other provider in this project.
const DISCOVERY_ROWS = 10;

const LINKEDIN_DISCOVERY_MARKETS: ReadonlyArray<{ market: string; locations: string[]; refreshScope: string }> = [
  { market: "lebanon", locations: ["Lebanon"], refreshScope: "linkedin:lebanon" },
  { market: "saudi", locations: ["Saudi Arabia"], refreshScope: "linkedin:saudi" },
  { market: "uae", locations: ["United Arab Emirates"], refreshScope: "linkedin:uae" },
  { market: "qatar", locations: ["Qatar"], refreshScope: "linkedin:qatar" },
  { market: "kuwait", locations: ["Kuwait"], refreshScope: "linkedin:kuwait" },
];

/**
 * Pure seed builder — unaware of the enabled flag, so it is independently
 * testable without mutating providerConfig.ts's module state. The real
 * safety gate lives in getLinkedInDiscoverySeeds() below, the only
 * function any caller (the internal route) should actually use.
 */
export function buildLinkedInDiscoverySeeds(): LinkedInDiscoverySeed[] {
  return LINKEDIN_DISCOVERY_MARKETS.map((m) => ({
    market: m.market,
    actorUrl: BEBITY_ACTOR_URL,
    requestBody: { rows: DISCOVERY_ROWS, locations: m.locations, companyProfile: false, enrichCompany: false },
    refreshScope: m.refreshScope,
    maxJobsPerRun: DISCOVERY_ROWS,
    maxTotalChargeUsd: computeMaxTotalChargeUsd(DISCOVERY_ROWS),
  }));
}

/**
 * Returns the full discovery seed list when providerConfig.ts's
 * linkedin.enabled is true, or an empty array otherwise. Never partially
 * enabled per-market — a future per-market rollout would need its own
 * explicit config field, not implemented here (not needed yet; one global
 * flag matches providerConfig.ts's existing single-flag-per-provider shape).
 */
export function getLinkedInDiscoverySeeds(): LinkedInDiscoverySeed[] {
  if (!isProviderEnabled("linkedin")) return [];
  return buildLinkedInDiscoverySeeds();
}
