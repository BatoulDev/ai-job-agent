// GulfTalent.com adapter, via the Apify actor
// `blackfalcondata/gulftalent-scraper` (Phase 16, Tier C — multi-company
// feed). Same access-model reasoning as bayt.ts: no official API, real
// robots.txt/403 confirmed direct-scraping is blocked — see
// docs/LEBANON_GULF_SOURCE_RESEARCH.md §5.
//
// LIVE-VERIFIED (Phase 21, Gulf only): a real 10-item Saudi Arabia
// benchmark run (~$0.02) confirmed most fields, with two real drifts
// fixed below — the field is really named `seniorityId` (a bare numeric
// code, e.g. 1/2/4/6, not the assumed `seniority` free-text field — no
// legend for the codes was found, so `seniority` stays unmapped rather
// than guessed), and a real `isRemote` boolean field DOES exist (the
// prior assumption that no remote signal exists at all was wrong — 1/10
// real jobs had isRemote:true). applyUrl was present in all 10 real
// jobs, including one genuine third-party ATS link
// (career4.successfactors.com) — the best apply-link provenance
// observed of any Apify-sourced provider this project has tested. No
// Lebanon test was run — Phase 20 already confirmed the actor's
// `country` input has no Lebanon option; see
// docs/LEBANON_LIVE_SOURCE_EXPANSION.md.
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
  // Phase 21 live benchmark: real remote-work signal, present on 1/10
  // real Saudi jobs — the earlier assumption that no such field exists
  // was wrong.
  isRemote?: boolean;
  // Phase 21 live benchmark: the real field is `seniorityId`, a bare
  // numeric code (1, 2, 4, 6 observed) with no published legend — mapping
  // it to this project's `seniority` enum would be guessing at what each
  // number means, exactly what AGENTS.md §30 prohibits. Captured for
  // inspection if GulfTalent ever documents the code meanings.
  seniorityId?: number;
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
    title: typeof raw.title === "string" ? stripHtml(raw.title) : null,
    description: stripHtml(raw.description),
    companyName: typeof raw.company === "string" ? raw.company.trim() : null,
    rawLocation: typeof raw.location === "string" && raw.location.trim() ? raw.location.trim() : null,
    providerWorkArrangement: raw.isRemote === true ? "remote" : null,
    applicationUrl: typeof raw.applyUrl === "string" ? raw.applyUrl : null,
    applicationEmail: null,
    employmentType: raw.employmentType ? (EMPLOYMENT_TYPE_MAP[raw.employmentType] ?? null) : null,
    seniority: null,
    publishedAt: raw.postedAt ?? null,
    sourceLastModifiedAt: null,
    sourceListingUrl: typeof raw.applyUrl === "string" ? raw.applyUrl : null,
  };
}
