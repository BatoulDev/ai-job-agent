// Centralized provider configuration (Phase 13 §7). One entry per
// ingestion provider — company-specific ATS types (Greenhouse/Lever/
// Workable/Ashby) are configured once here even though they fan out to
// many company_sources rows, and multi-company feeds (RemoteOK/Jobicy/...)
// are configured once per provider. Adding a new provider going forward is:
// one adapter (src/lib/ingestion/providers/*.ts for multi-company feeds, or
// a deriveAtsFeedUrl.ts branch for a new Tier-A ATS) + one entry below +
// tests — never a downstream rewrite of matching/eligibility/persistence,
// which stay provider-agnostic by construction (see ingestSourceBatch.ts).
//
// This is a plain code module, not a database table: every value here is
// reviewed the same way any other code change is, and "enabled" is a
// deliberate, git-tracked decision rather than a runtime toggle a bad
// actor or bad input could flip. Per-source trust (is THIS company
// actually approved) stays exactly where Phase 03 put it — company_sources
// for Tier A/B, or this config's own `enabled` flag as the provider-level
// trust gate for Tier C/D multi-company feeds, which have no per-company
// row to check.

import type { JobSourceType } from "./rawProviderJob.ts";

export type ProviderTier = "A" | "B" | "C" | "D";
export type ProviderKind = "company_specific" | "multi_company_feed";
export type MarketTag = "lebanon" | "saudi-arabia" | "qatar" | "kuwait" | "uae" | "international-remote";

export interface ProviderConfig {
  sourceType: JobSourceType;
  displayName: string;
  tier: ProviderTier;
  kind: ProviderKind;
  /** Deliberate, reviewed go-live decision — see module header. */
  enabled: boolean;
  /** Which lanes this provider can contribute jobs to, per Phase 12's coverage matrix. */
  markets: readonly MarketTag[];
  /** Lower runs first when a future orchestrator schedules multiple providers in one pass. */
  priority: number;
  /** Documentation only — the actual cadence lives in the n8n workflow/schedule trigger, not here. */
  scheduleHint: string;
  /** A job not re-seen by this provider for longer than this is a stale-close candidate. */
  freshnessCutoffDays: number;
  maxJobsPerRun: number;
  paginated: boolean;
  retry: { maxTries: number; waitBetweenTriesMs: number };
  /** Non-null names the env var carrying a paid-API cost ceiling / per-run budget note; null = free. */
  costGuardNote: string | null;
  /** Env var name a live call needs; null when no credential is required at all. */
  requiresCredentialEnvVar: string | null;
  rateLimitHint: string | null;
  notes: string;
}

// Tier A: company-specific ATS adapters. One entry covers every
// company_sources row using that ATS — see findEligibleCompanySources.ts /
// deriveAtsFeedUrl.ts for the per-company fan-out.
const TIER_A_PROVIDERS: readonly ProviderConfig[] = [
  {
    sourceType: "greenhouse",
    displayName: "Greenhouse (direct ATS)",
    tier: "A",
    kind: "company_specific",
    enabled: true,
    markets: ["lebanon", "saudi-arabia", "qatar", "kuwait", "uae", "international-remote"],
    priority: 10,
    scheduleHint: "every 6h",
    freshnessCutoffDays: 30,
    maxJobsPerRun: 50,
    paginated: false,
    retry: { maxTries: 4, waitBetweenTriesMs: 5000 },
    costGuardNote: null,
    requiresCredentialEnvVar: null,
    rateLimitHint: "no documented public rate limit for the read-only jobs endpoint",
    notes: "Live since Phase 04/12.",
  },
  {
    sourceType: "lever",
    displayName: "Lever (direct ATS)",
    tier: "A",
    kind: "company_specific",
    enabled: true,
    markets: ["lebanon", "saudi-arabia", "qatar", "kuwait", "uae", "international-remote"],
    priority: 10,
    scheduleHint: "every 6h",
    freshnessCutoffDays: 30,
    maxJobsPerRun: 50,
    paginated: false,
    retry: { maxTries: 4, waitBetweenTriesMs: 5000 },
    costGuardNote: null,
    requiresCredentialEnvVar: null,
    rateLimitHint: "no documented public rate limit",
    notes: "Live since Phase 04/12.",
  },
  {
    sourceType: "workable",
    displayName: "Workable (direct ATS)",
    tier: "A",
    kind: "company_specific",
    enabled: true,
    markets: ["lebanon", "saudi-arabia", "qatar", "kuwait", "uae", "international-remote"],
    priority: 10,
    scheduleHint: "every 6h",
    freshnessCutoffDays: 30,
    maxJobsPerRun: 50,
    paginated: false,
    retry: { maxTries: 4, waitBetweenTriesMs: 5000 },
    costGuardNote: null,
    requiresCredentialEnvVar: null,
    rateLimitHint: "no documented public rate limit for the widget accounts endpoint",
    notes: "Live since Phase 04/12.",
  },
  {
    sourceType: "ashby",
    displayName: "Ashby (direct ATS)",
    tier: "A",
    kind: "company_specific",
    enabled: true,
    markets: ["lebanon", "saudi-arabia", "qatar", "kuwait", "uae", "international-remote"],
    priority: 10,
    scheduleHint: "every 6h",
    freshnessCutoffDays: 30,
    maxJobsPerRun: 50,
    paginated: false,
    retry: { maxTries: 4, waitBetweenTriesMs: 5000 },
    costGuardNote: null,
    requiresCredentialEnvVar: null,
    rateLimitHint: "no documented public rate limit for the posting-api job-board endpoint",
    notes: "New this phase (Phase 13). Live-verified against a real registry row (The Utopia Studio, Qatar) — see deriveAtsFeedUrl.ts.",
  },
  {
    sourceType: "oracle_hcm",
    displayName: "Oracle Cloud Recruiting (direct ATS)",
    tier: "A",
    kind: "company_specific",
    enabled: true,
    markets: ["lebanon", "saudi-arabia", "qatar", "kuwait", "uae"],
    priority: 10,
    scheduleHint: "every 6h",
    freshnessCutoffDays: 30,
    maxJobsPerRun: 50,
    paginated: false,
    retry: { maxTries: 4, waitBetweenTriesMs: 5000 },
    costGuardNote: null,
    requiresCredentialEnvVar: null,
    rateLimitHint: "no documented public rate limit for the recruitingCEJobRequisitions endpoint",
    notes: "New this phase (Phase 16). Live-verified against a real registry row (AUBMC, Lebanon) — a direct, unauthenticated GET returned real job data with no key. See docs/LEBANON_GULF_SOURCE_RESEARCH.md §3 and deriveAtsFeedUrl.ts. The candidate-facing apply URL is on a different path than the REST API (no auth needed either) — the n8n extraction step stamps it onto each raw job; see providers/oracle-hcm.ts's header comment.",
  },
];

// Tier D: international-remote multi-company feeds, free public APIs, no
// credential required. Implemented and live-verified this phase.
const TIER_D_PROVIDERS: readonly ProviderConfig[] = [
  {
    sourceType: "remoteok",
    displayName: "RemoteOK",
    tier: "D",
    kind: "multi_company_feed",
    enabled: true,
    markets: ["international-remote"],
    priority: 20,
    scheduleHint: "every 6h",
    freshnessCutoffDays: 14,
    maxJobsPerRun: 40,
    paginated: false,
    retry: { maxTries: 3, waitBetweenTriesMs: 5000 },
    costGuardNote: null,
    requiresCredentialEnvVar: null,
    rateLimitHint: "no documented rate limit; ToS requires attribution/backlink, not a technical header",
    notes: "Live-verified this phase (direct GET https://remoteok.com/api). apply_url/url both point at the remoteok.com listing page, not the employer directly — that is RemoteOK's own model, not a mapping gap.",
  },
  {
    sourceType: "jobicy",
    displayName: "Jobicy",
    tier: "D",
    kind: "multi_company_feed",
    enabled: true,
    markets: ["international-remote"],
    priority: 20,
    scheduleHint: "every 6h",
    freshnessCutoffDays: 14,
    maxJobsPerRun: 40,
    paginated: false,
    retry: { maxTries: 3, waitBetweenTriesMs: 5000 },
    costGuardNote: null,
    requiresCredentialEnvVar: null,
    rateLimitHint: "no documented rate limit",
    notes: "Live-verified this phase (direct GET https://jobicy.com/api/v2/remote-jobs?count=N).",
  },
  {
    sourceType: "arbeitnow",
    displayName: "Arbeitnow",
    tier: "D",
    kind: "multi_company_feed",
    enabled: true,
    markets: ["international-remote"],
    priority: 20,
    scheduleHint: "every 6h",
    freshnessCutoffDays: 14,
    maxJobsPerRun: 40,
    paginated: true,
    retry: { maxTries: 3, waitBetweenTriesMs: 5000 },
    costGuardNote: null,
    requiresCredentialEnvVar: null,
    rateLimitHint: "no documented rate limit",
    notes: "Live-verified this phase (direct GET https://www.arbeitnow.com/api/job-board-api, paginated via links.next). Only jobs with remote:true are adapted — most listings are DACH-region onsite roles.",
  },
];

// Tier C: MENA/Gulf and general aggregators. Credential-blocked or
// authorization-blocked this phase — adapter/config/fixture-test
// scaffolding exists so flipping `enabled: true` is the only step once a
// credential/authorization is obtained, per Phase 13 §3's explicit
// "still implement contract, config, fixtures, tests... do not stop the
// whole phase" instruction. See docs/PROVIDER_EXPANSION_IMPLEMENTATION.md
// for exactly what's implemented vs. still needed for each.
const TIER_C_PROVIDERS: readonly ProviderConfig[] = [
  {
    sourceType: "jsearch",
    displayName: "JSearch (RapidAPI)",
    tier: "C",
    kind: "multi_company_feed",
    enabled: false,
    markets: ["saudi-arabia", "qatar", "kuwait", "uae", "international-remote"],
    priority: 30,
    scheduleHint: "daily",
    freshnessCutoffDays: 7,
    maxJobsPerRun: 40,
    paginated: true,
    retry: { maxTries: 3, waitBetweenTriesMs: 5000 },
    costGuardNote: "RapidAPI metered plan — set a monthly request cap in the RapidAPI dashboard before enabling",
    requiresCredentialEnvVar: "JSEARCH_API_KEY",
    rateLimitHint: "per-plan RapidAPI rate limit, not yet chosen",
    notes: "BLOCKED_ON_CREDENTIAL. Adapter parses the documented JSearch response schema (data[].job_id/job_title/employer_name/job_description/job_apply_link/job_city/job_country/...) — this has NOT been verified against a live call (no key available). Re-verify field names against a real response before flipping enabled:true.",
  },
  {
    sourceType: "adzuna",
    displayName: "Adzuna",
    tier: "C",
    kind: "multi_company_feed",
    enabled: false,
    markets: ["saudi-arabia", "qatar", "kuwait", "uae", "international-remote"],
    priority: 30,
    scheduleHint: "daily",
    freshnessCutoffDays: 7,
    maxJobsPerRun: 40,
    paginated: true,
    retry: { maxTries: 3, waitBetweenTriesMs: 5000 },
    costGuardNote: "Adzuna free tier request cap — confirm current limits at signup before enabling",
    requiresCredentialEnvVar: "ADZUNA_APP_ID / ADZUNA_APP_KEY",
    rateLimitHint: "Adzuna free-tier daily call cap, exact number not yet confirmed",
    notes: "BLOCKED_ON_CREDENTIAL. Adapter parses the documented Adzuna /search response schema (results[].id/title/description/company.display_name/location.display_name/redirect_url/created/...) — NOT verified against a live call (no App ID/key available). Re-verify before flipping enabled:true. Adzuna does not currently list Lebanon/Kuwait as a supported country code — confirm coverage per-market once a key exists.",
  },
  {
    sourceType: "bayt",
    displayName: "Bayt (via Apify blackfalcondata/bayt-scraper)",
    tier: "C",
    kind: "multi_company_feed",
    enabled: false,
    markets: ["lebanon", "saudi-arabia", "qatar", "kuwait", "uae"],
    priority: 40,
    scheduleHint: "daily",
    freshnessCutoffDays: 7,
    maxJobsPerRun: 40,
    paginated: false,
    retry: { maxTries: 2, waitBetweenTriesMs: 5000 },
    costGuardNote: "~$0.99 per 1000 results (blackfalcondata/bayt-scraper's real published pricing, confirmed this phase — docs/LEBANON_GULF_SOURCE_RESEARCH.md §5) — bound every run with maxJobsPerRun and monitor Apify usage",
    requiresCredentialEnvVar: "APIFY_API_TOKEN",
    rateLimitHint: "governed by Apify actor run concurrency, not a per-request limit",
    notes: "BLOCKED_ON_AUTHORIZATION, not credential — APIFY_API_TOKEN is already configured. Phase 16: adapter (providers/bayt.ts) now exists, written from the actor's own published Store-page output schema (confirmed real/maintained this phase: 557 users, 100% run success rate) — but still NOT LIVE-VERIFIED, since zero Apify runs against it have actually been made. Needs one explicitly-authorized bounded benchmark run to confirm the real output before flipping enabled:true.",
  },
  {
    sourceType: "gulftalent",
    displayName: "GulfTalent (via Apify blackfalcondata/gulftalent-scraper)",
    tier: "C",
    kind: "multi_company_feed",
    enabled: false,
    markets: ["lebanon", "saudi-arabia", "qatar", "kuwait", "uae"],
    priority: 40,
    scheduleHint: "daily",
    freshnessCutoffDays: 7,
    maxJobsPerRun: 40,
    paginated: false,
    retry: { maxTries: 2, waitBetweenTriesMs: 5000 },
    costGuardNote: "~$0.70-0.75 per 1000 results (confirmed this phase — docs/LEBANON_GULF_SOURCE_RESEARCH.md §5) — same guard as Bayt above",
    requiresCredentialEnvVar: "APIFY_API_TOKEN",
    rateLimitHint: "governed by Apify actor run concurrency",
    notes: "Same reasoning as Bayt above: BLOCKED_ON_AUTHORIZATION. Phase 16: adapter (providers/gulftalent.ts) exists, documented-schema only, not live-verified. Markets widened to include Lebanon this phase — real Lebanon listings (~477) were confirmed live on gulftalent.com despite the actor's nominal market list not naming Lebanon explicitly.",
  },
  {
    sourceType: "workday",
    displayName: "Workday (direct ATS)",
    tier: "A",
    kind: "company_specific",
    enabled: false,
    markets: ["lebanon", "saudi-arabia", "qatar", "kuwait"],
    priority: 10,
    scheduleHint: "every 6h",
    freshnessCutoffDays: 30,
    maxJobsPerRun: 50,
    paginated: false,
    retry: { maxTries: 4, waitBetweenTriesMs: 5000 },
    costGuardNote: null,
    requiresCredentialEnvVar: null,
    rateLimitHint: "no documented public rate limit for the wday/cxs jobs endpoint",
    notes: "BLOCKED_ON_ARCHITECTURE, not credential — Phase 16: the list endpoint (confirmed live, real Murex tenant, no auth) carries no job description field at all, so every real job is honestly rejected by validateRawProviderJob's missing_description rule until a second, per-job detail-page fetch is added — an architecture no other Tier-A source in this pipeline has needed (all of Greenhouse/Lever/Workable/Ashby/Oracle include a description in their one list call). Adapter mapping logic (providers/workday.ts) is real and tested against a real observed response; NOT wired into the n8n workflow or run-batch's accepted source types this phase. See docs/LEBANON_GULF_SOURCE_RESEARCH.md §3 and the Phase 16 implementation notes.",
  },
];

export const PROVIDER_CONFIGS: readonly ProviderConfig[] = [...TIER_A_PROVIDERS, ...TIER_D_PROVIDERS, ...TIER_C_PROVIDERS];

const BY_SOURCE_TYPE = new Map(PROVIDER_CONFIGS.map((p) => [p.sourceType, p]));

export function getProviderConfig(sourceType: JobSourceType): ProviderConfig | undefined {
  return BY_SOURCE_TYPE.get(sourceType);
}

/** Fail-closed: an unknown or unlisted source type is never treated as enabled. */
export function isProviderEnabled(sourceType: JobSourceType): boolean {
  return BY_SOURCE_TYPE.get(sourceType)?.enabled === true;
}

export function getEnabledProviders(kind?: ProviderKind): ProviderConfig[] {
  return PROVIDER_CONFIGS.filter((p) => p.enabled && (kind === undefined || p.kind === kind));
}

export function getProvidersForMarket(market: MarketTag): ProviderConfig[] {
  return PROVIDER_CONFIGS.filter((p) => p.enabled && p.markets.includes(market));
}
