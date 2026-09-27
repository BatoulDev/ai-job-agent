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
  sourceType: Extract<JobSourceType, "greenhouse" | "lever" | "workable">;
  feedUrl: string;
}

const GREENHOUSE_EU_PATTERN = /job-boards\.eu\.greenhouse\.io\/([a-z0-9-]+)/i;
const GREENHOUSE_PATTERN = /(?:job-boards|boards)\.greenhouse\.io\/([a-z0-9-]+)/i;
const LEVER_PATTERN = /jobs\.lever\.co\/([a-z0-9.-]+)/i;
const WORKABLE_PATTERN = /apply\.workable\.com\/([a-z0-9-]+)/i;

/** ats_provider is researcher-entered free text (e.g. "Greenhouse", "Workable", "Oracle Cloud HCM") — normalize before matching. */
function normalizeAtsProviderLabel(atsProvider: string | null): string {
  return (atsProvider ?? "").toLowerCase();
}

export function deriveAtsFeedUrl(atsProvider: string | null, officialCareersUrl: string | null): DerivedAtsFeedUrl | null {
  if (!officialCareersUrl) return null;
  const label = normalizeAtsProviderLabel(atsProvider);

  if (label.includes("greenhouse")) {
    const euMatch = officialCareersUrl.match(GREENHOUSE_EU_PATTERN);
    if (euMatch) {
      return { sourceType: "greenhouse", feedUrl: `https://boards-api.eu.greenhouse.io/v1/boards/${euMatch[1]}/jobs?content=true` };
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

  return null;
}
