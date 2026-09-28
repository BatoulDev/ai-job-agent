// Bayt.com adapter, via the Apify actor `blackfalcondata/bayt-scraper`
// (Phase 16, Tier C — multi-company feed). Bayt has no official API and
// its own robots.txt disallows direct scraping of job-listing paths —
// see docs/LEBANON_GULF_SOURCE_RESEARCH.md §5 — so this adapter's raw
// input is the actor's own dataset output, fetched by n8n calling Apify's
// REST API, never Bayt directly.
//
// *** NOT LIVE-VERIFIED — BLOCKED_ON_AUTHORIZATION ***
// APIFY_API_TOKEN already exists in this project, but no real Apify run
// against this actor has been made yet (zero credits spent). Field names
// below follow the actor's own published Store-page output schema
// (mature actor: 557 total users, 120 monthly active, 100% run success
// rate at research time), not a verified live call. Before flipping
// providerConfig.ts's bayt.enabled to true: run one small, explicitly
// authorized, bounded Apify run and confirm every field name below still
// matches the actual dataset output — do not trust this file alone as
// proof the integration works (AGENTS.md §30).
import type { RawProviderJob } from "../rawProviderJob.ts";
import { stripHtml } from "./shared.ts";

export interface BaytRawJob {
  jobId?: string | number;
  title?: string;
  company?: string;
  location?: string;
  city?: string;
  country?: string;
  employmentType?: string;
  description?: string;
  isRemote?: boolean;
  url?: string;
  applyUrl?: string;
  postedDate?: string;
  // Present in the actor's own published Store-page output schema
  // (docs/LEBANON_GULF_SOURCE_RESEARCH.md §5) but NOT yet mapped to
  // this project's `seniority` enum ("internship"|"entry-level"|
  // "junior"|"mid-level"|"senior") — the actor's real value vocabulary
  // for this field (e.g. exact strings like "Mid Career"/"Senior
  // Management"/"Entry Level") has never been observed live, and
  // guessing a translation table from the field name alone would be
  // exactly the kind of invented mapping AGENTS.md §30 prohibits.
  // Captured here so a real live response can be inspected directly
  // during Phase 20's benchmark — see docs/BAYT_GULFTALENT_LIVE_PREP.md's
  // Live Schema Validation Checklist, "seniority mapping" item.
  careerLevel?: string;
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  "Full Time": "full-time",
  "Part Time": "part-time",
  Contract: "contract",
  Freelance: "contract",
  Internship: "internship",
};

function buildRawLocation(raw: BaytRawJob): string | null {
  if (typeof raw.location === "string" && raw.location.trim()) return raw.location.trim();
  const parts = [raw.city, raw.country].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function mapBaytJob(raw: BaytRawJob): RawProviderJob {
  return {
    externalId: raw.jobId != null ? String(raw.jobId) : "",
    title: typeof raw.title === "string" ? raw.title : null,
    description: stripHtml(raw.description),
    companyName: typeof raw.company === "string" ? raw.company.trim() : null,
    rawLocation: buildRawLocation(raw),
    providerWorkArrangement: raw.isRemote === true ? "remote" : null,
    applicationUrl: (typeof raw.applyUrl === "string" ? raw.applyUrl : null) ?? (typeof raw.url === "string" ? raw.url : null),
    applicationEmail: null,
    employmentType: raw.employmentType ? (EMPLOYMENT_TYPE_MAP[raw.employmentType] ?? null) : null,
    seniority: null,
    publishedAt: raw.postedDate ?? null,
    sourceLastModifiedAt: null,
    sourceListingUrl: raw.url ?? null,
  };
}
