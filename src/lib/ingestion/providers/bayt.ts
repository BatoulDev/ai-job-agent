// Bayt.com adapter, via the Apify actor `blackfalcondata/bayt-scraper`
// (Phase 16, Tier C — multi-company feed). Bayt has no official API and
// its own robots.txt disallows direct scraping of job-listing paths —
// see docs/LEBANON_GULF_SOURCE_RESEARCH.md §5 — so this adapter's raw
// input is the actor's own dataset output, fetched by n8n calling Apify's
// REST API, never Bayt directly.
//
// LIVE-VERIFIED (Phase 21): two real, bounded runs (10 then 25 Lebanon
// results, $0.036 total) confirmed every field this adapter reads is
// present and shaped as expected, with two real drifts fixed below
// (employmentType casing/wording, title HTML entities) and a
// previously-unmapped field (careerLevel) now mapped from real observed
// values only. `jobId` was confirmed stable for the same real job across
// two independent runs — the idempotency assumption this project's dedup
// depends on holds. `applyUrl` was present in only 3/25 (12%) real jobs;
// the other 88% correctly fall back to `url` (the listing page) per the
// logic below — expected, not a bug, but worth knowing most Bayt jobs
// send users to a listing page rather than a direct apply link. See
// docs/LEBANON_LIVE_SOURCE_EXPANSION.md for the full benchmark record.
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
  // Real observed values (Phase 21 live benchmark, 25 Lebanon jobs):
  // "Unspecified", "Mid career", "Entry level", "Senior executive",
  // "Management". Mapped to this project's `seniority` enum below only
  // for the values with an unambiguous match — "Unspecified" and
  // "Management" are deliberately left unmapped (Management describes a
  // role level, not an experience band, and guessing would violate
  // AGENTS.md §30).
  careerLevel?: string;
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  "Full Time": "full-time",
  // Phase 21 live benchmark: the actor's real value is "Full time"
  // (lowercase "t"), not "Full Time" — confirmed across 24/25 real
  // Lebanon jobs. Keeping both spellings since the capitalized form is
  // still the actor's own documented Store-page example.
  "Full time": "full-time",
  "Part Time": "part-time",
  Contract: "contract",
  // Phase 21 live benchmark: real value observed as "Contractor", not
  // "Contract".
  Contractor: "contract",
  Freelance: "contract",
  Internship: "internship",
};

// Phase 21 live benchmark: only the unambiguous real-observed values are
// mapped; everything else (including "Unspecified" and "Management")
// stays unmapped rather than guessed.
const CAREER_LEVEL_TO_SENIORITY: Record<string, string> = {
  "Entry level": "entry-level",
  "Mid career": "mid-level",
  "Senior executive": "senior",
};

function buildRawLocation(raw: BaytRawJob): string | null {
  if (typeof raw.location === "string" && raw.location.trim()) return raw.location.trim();
  const parts = [raw.city, raw.country].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function mapBaytJob(raw: BaytRawJob): RawProviderJob {
  return {
    externalId: raw.jobId != null ? String(raw.jobId) : "",
    // Phase 21 live benchmark: real titles can contain raw HTML entities
    // (e.g. "Playground &amp; Host Cashier") — stripHtml() decodes them
    // (it is also a no-op on plain text, safe for titles with no markup).
    title: typeof raw.title === "string" ? stripHtml(raw.title) : null,
    description: stripHtml(raw.description),
    companyName: typeof raw.company === "string" ? raw.company.trim() : null,
    rawLocation: buildRawLocation(raw),
    providerWorkArrangement: raw.isRemote === true ? "remote" : null,
    applicationUrl: (typeof raw.applyUrl === "string" ? raw.applyUrl : null) ?? (typeof raw.url === "string" ? raw.url : null),
    applicationEmail: null,
    employmentType: raw.employmentType ? (EMPLOYMENT_TYPE_MAP[raw.employmentType] ?? null) : null,
    seniority: raw.careerLevel ? (CAREER_LEVEL_TO_SENIORITY[raw.careerLevel] ?? null) : null,
    publishedAt: raw.postedDate ?? null,
    sourceLastModifiedAt: null,
    sourceListingUrl: raw.url ?? null,
  };
}
