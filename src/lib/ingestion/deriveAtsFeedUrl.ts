// Pure URL-derivation heuristic (Phase 12): given a company_sources row's
// researcher-recorded ats_provider + official_careers_url, derive the real
// callable JSON API endpoint for Greenhouse/Lever/Workable — the same three
// ATS types this project already has provider adapters for (Phase 04). No
// network, no DB, no invented data: returns null whenever the URL doesn't
// match a recognized pattern, rather than guessing.
//
// Why this exists: n8n-workflows/ai-job-agent-01-job-ingestion.ts's own
// "Known limitation" sticky note documented that company_sources (593 rows
// as of this phase) has no feed-url/board-token column, so the workflow
// reused only a 4-source hardcoded pilot list. This function is that
// missing derivation step — verified against real registry rows (see
// docs/SOURCE_COVERAGE_AND_PROVIDER_EXPANSION_AUDIT.md): 11 of the 593 rows
// have a directly-derivable Greenhouse/Lever/Workable feed URL this way,
// nearly 3x the prior hardcoded set, at zero new cost or credential.
//
// Not exhaustive by design: many companies embed their ATS widget on their
// own domain (e.g. https://company.com/careers) rather than linking the
// ATS's own hosted board directly — those rows are correctly left
// undiscoverable here (ponytail: this is a real ceiling, not a bug; a
// broader solution needs either a persisted feed_url column populated by a
// human researcher, or HTML-extraction, neither guessed here).
import type { JobSourceType } from "./rawProviderJob.ts";

export interface DerivedAtsFeedUrl {
  sourceType: Extract<JobSourceType, "greenhouse" | "lever" | "workable" | "ashby" | "oracle_hcm">;
  feedUrl: string;
}

const GREENHOUSE_EU_PATTERN = /job-boards\.eu\.greenhouse\.io\/([a-z0-9-]+)/i;
const GREENHOUSE_PATTERN = /(?:job-boards|boards)\.greenhouse\.io\/([a-z0-9-]+)/i;
const LEVER_PATTERN = /jobs\.lever\.co\/([a-z0-9.-]+)/i;
const WORKABLE_PATTERN = /apply\.workable\.com\/([a-z0-9-]+)/i;
// Phase 13: confirmed live against a real registry row (The Utopia Studio,
// sr-qa-the-utopia-studio, official_careers_url
// https://jobs.ashbyhq.com/the-studio) — GET
// https://api.ashbyhq.com/posting-api/job-board/the-studio returns real,
// current job postings.
const ASHBY_PATTERN = /jobs\.ashbyhq\.com\/([a-z0-9-]+)/i;
// Phase 16: confirmed live against a real registry row (AUBMC,
// official_careers_url updated this phase from the generic
// aubmc.org.lb landing page to this real, confirmed Oracle Cloud
// Recruiting candidate-experience URL — see
// docs/LEBANON_GULF_SOURCE_RESEARCH.md §3). A direct GET to
// {host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?
// finder=findReqs;siteNumber={site}&expand=requisitionList returns real
// job data with no auth. The candidate-facing apply URL
// ({host}/hcmUI/CandidateExperience/en/sites/{site}/job/{id}) is a
// sibling path on the same host, reconstructed by the n8n extraction step
// from this same feed URL (see oracle-hcm.ts's own header comment) since
// Oracle's REST response carries no candidate-facing URL of its own.
const ORACLE_PATTERN = /https:\/\/([a-z0-9.-]+)\/hcmUI\/CandidateExperience\/[a-z]{2}\/sites\/([A-Za-z0-9_]+)/i;

/** ats_provider is researcher-entered free text (e.g. "Greenhouse", "Workable", "Oracle Cloud HCM") — normalize before matching. */
function normalizeAtsProviderLabel(atsProvider: string | null): string {
  return (atsProvider ?? "").toLowerCase();
}

export function deriveAtsFeedUrl(atsProvider: string | null, officialCareersUrl: string | null): DerivedAtsFeedUrl | null {
  if (!officialCareersUrl) return null;
  const label = normalizeAtsProviderLabel(atsProvider);

  if (label.includes("greenhouse")) {
    // 2026-10-02 fix: there is no boards-api.eu.greenhouse.io — confirmed by
    // live DNS lookup (ENOTFOUND) and by a live GET against the global host
    // below succeeding with real job data (Tamara, a real job-boards.eu
    // tenant, returned 32 real jobs from boards-api.greenhouse.io). Only the
    // human-facing board page is region-prefixed (job-boards.eu.*); the
    // Job Board API itself is one single global host for every tenant
    // regardless of which board-page region they're hosted under.
    const euMatch = officialCareersUrl.match(GREENHOUSE_EU_PATTERN);
    if (euMatch) {
      return { sourceType: "greenhouse", feedUrl: `https://boards-api.greenhouse.io/v1/boards/${euMatch[1]}/jobs?content=true` };
    }
    const match = officialCareersUrl.match(GREENHOUSE_PATTERN);
    if (match) {
      return { sourceType: "greenhouse", feedUrl: `https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs?content=true` };
    }
    return null;
  }

  if (label.includes("lever")) {
    const match = officialCareersUrl.match(LEVER_PATTERN);
    if (match) {
      return { sourceType: "lever", feedUrl: `https://api.lever.co/v0/postings/${match[1]}?mode=json` };
    }
    return null;
  }

  if (label.includes("workable")) {
    const match = officialCareersUrl.match(WORKABLE_PATTERN);
    if (match) {
      return { sourceType: "workable", feedUrl: `https://apply.workable.com/api/v1/widget/accounts/${match[1]}?details=true` };
    }
    return null;
  }

  if (label.includes("ashby")) {
    const match = officialCareersUrl.match(ASHBY_PATTERN);
    if (match) {
      return { sourceType: "ashby", feedUrl: `https://api.ashbyhq.com/posting-api/job-board/${match[1]}` };
    }
    return null;
  }

  if (label.includes("oracle")) {
    const match = officialCareersUrl.match(ORACLE_PATTERN);
    if (match) {
      const [, host, siteNumber] = match;
      return {
        sourceType: "oracle_hcm",
        feedUrl: `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?finder=findReqs;siteNumber=${siteNumber}&expand=requisitionList&limit=50`,
      };
    }
    return null;
  }

  return null;
}
