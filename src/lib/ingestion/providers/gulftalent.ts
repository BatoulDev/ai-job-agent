// GulfTalent.com adapter, via the Apify actor
// `blackfalcondata/gulftalent-scraper` (Phase 16, Tier C — multi-company
// feed). Same access-model reasoning as bayt.ts: no official API, real
// robots.txt/403 confirmed direct-scraping is blocked — see
// docs/LEBANON_GULF_SOURCE_RESEARCH.md §5.
//
// *** NOT LIVE-VERIFIED — BLOCKED_ON_AUTHORIZATION ***
// Same caveat as bayt.ts: field names below follow the actor's own
// published Store-page output schema (267 total users, 97.2% run success
// rate at research time), never exercised against a real call. Before
// flipping providerConfig.ts's gulftalent.enabled to true: run one small,
// explicitly authorized, bounded Apify run and confirm every field name
// below still matches the actual dataset output (AGENTS.md §30).
import type { RawProviderJob } from "../rawProviderJob.ts";
import { stripHtml } from "./shared.ts";

export interface GulfTalentRawJob {
  jobId?: string | number;
  jobKey?: string;
  title?: string;
  company?: string;
  location?: string;
  employmentType?: string;
  description?: string;
  applyUrl?: string;
  postedAt?: string;
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  "Full Time": "full-time",
  "Part Time": "part-time",
  Contract: "contract",
  Freelance: "contract",
  Internship: "internship",
};

export function mapGulfTalentJob(raw: GulfTalentRawJob): RawProviderJob {
  // jobId is the actor's documented primary identifier; jobKey is a
  // secondary field also present in its schema — prefer jobId, fall back
  // to jobKey only if jobId is genuinely absent, never invent a third
  // value.
  const externalId = raw.jobId != null ? String(raw.jobId) : typeof raw.jobKey === "string" ? raw.jobKey : "";
  return {
    externalId,
    title: typeof raw.title === "string" ? raw.title : null,
    description: stripHtml(raw.description),
    companyName: typeof raw.company === "string" ? raw.company.trim() : null,
    rawLocation: typeof raw.location === "string" && raw.location.trim() ? raw.location.trim() : null,
    providerWorkArrangement: null,
    applicationUrl: typeof raw.applyUrl === "string" ? raw.applyUrl : null,
    applicationEmail: null,
    employmentType: raw.employmentType ? (EMPLOYMENT_TYPE_MAP[raw.employmentType] ?? null) : null,
    seniority: null,
    publishedAt: raw.postedAt ?? null,
    sourceLastModifiedAt: null,
    sourceListingUrl: typeof raw.applyUrl === "string" ? raw.applyUrl : null,
  };
}
