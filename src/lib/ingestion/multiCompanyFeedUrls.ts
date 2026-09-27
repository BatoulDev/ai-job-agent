// Pure feed-URL construction for enabled multi-company providers (Phase
// 13). Unlike Tier-A ATS feeds (one URL per company, derived from a
// company_sources row — see deriveAtsFeedUrl.ts), a multi-company
// provider's feed URL is the same for every run and takes no per-company
// input; the only variable is how many jobs to request, from
// providerConfig.ts's maxJobsPerRun. No network, no DB — verified against
// each provider's real live response shape this phase (see
// docs/PROVIDER_EXPANSION_IMPLEMENTATION.md).
import { getProviderConfig, type ProviderConfig } from "./providerConfig.ts";
import type { JobSourceType } from "./rawProviderJob.ts";

export interface MultiCompanyFeedSource {
  sourceType: JobSourceType;
  feedUrl: string;
  paginated: boolean;
}

function buildFeedUrl(config: ProviderConfig): string | null {
  switch (config.sourceType) {
    case "remoteok":
      // No count/limit query param on the real live endpoint — it always
      // returns its current full list (100 items in this phase's live
      // check); maxJobsPerRun is enforced downstream by
      // runMultiCompanyIngestionBatch's truncation, not the fetch itself.
      return "https://remoteok.com/api";
    case "jobicy":
      return `https://jobicy.com/api/v2/remote-jobs?count=${config.maxJobsPerRun}`;
    case "arbeitnow":
      // Paginated via response.links.next — the first page's URL only;
      // the n8n HTTP Request node's native pagination option follows the
      // rest (see n8n-workflows/ai-job-agent-01-job-ingestion.ts).
      return "https://www.arbeitnow.com/api/job-board-api";
    default:
      // jsearch/adzuna/bayt/gulftalent: no static feed URL exists yet
      // (jsearch/adzuna need a credentialed request shape this module
      // deliberately does not build blind; bayt/gulftalent are Apify
      // actor runs, not a plain GET). None of these are enabled this
      // phase anyway — see providerConfig.ts.
      return null;
  }
}

/** Every enabled multi-company provider with a constructible feed URL, live-derivable with zero DB access. */
export function getEnabledMultiCompanyFeedSources(): MultiCompanyFeedSource[] {
  const sources: MultiCompanyFeedSource[] = [];
  for (const sourceType of ["remoteok", "jobicy", "arbeitnow"] as const) {
    const config = getProviderConfig(sourceType);
    if (!config?.enabled) continue;
    const feedUrl = buildFeedUrl(config);
    if (!feedUrl) continue;
    sources.push({ sourceType, feedUrl, paginated: config.paginated });
  }
  return sources;
}
