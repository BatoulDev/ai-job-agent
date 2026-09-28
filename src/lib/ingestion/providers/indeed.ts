// Indeed adapter, via the Apify actor `curious_coder/indeed-scraper`
// (Phase 21, Tier C — multi-company feed, same pattern as bayt.ts /
// gulftalent.ts). Indeed has no public listings API for this purpose, so
// this adapter's raw input is the actor's own dataset output, fetched by
// n8n calling Apify's REST API.
//
// LIVE-VERIFIED (Phase 21): a real 10-item Dubai (UAE) benchmark run
// ($0.001, run-start fee only) confirmed every field below against real
// output — see docs/LEBANON_LIVE_SOURCE_EXPANSION.md.
//
// IMPORTANT geography finding: the actor's `country` input is a fixed
// enum that does NOT include Lebanon (`lb` was rejected with a 400 —
// zero cost, the call never reached the actor). The real allowed list is
// Gulf-capable (bh, kw, om, qa, sa, ae) but Lebanon-incapable — this
// provider can only ever serve the Gulf tier for this project, never
// Lebanon, the same real limitation Phase 20 already found for
// GulfTalent.
//
// applyUrl provenance finding: `originalApplyUrl` in all 10 real samples
// pointed back to Indeed's own domain (`ae.indeed.com/job/...`), not an
// employer ATS/career page — despite the field's name implying an
// employer-original link. This is Indeed's real, legitimate application
// destination for Indeed-native postings (`jobSourceName: "Indeed"` on
// all 10 samples); it is not broken or invented, just not a direct
// employer link, the same category as most Bayt jobs falling back to
// Bayt's own listing page.
import type { RawProviderJob } from "../rawProviderJob.ts";
import { stripHtml } from "./shared.ts";

export interface IndeedRawJobLocation {
  countryCode?: string;
  countryName?: string;
  city?: string;
  formatted?: { long?: string; short?: string };
}

export interface IndeedRawJob {
  id?: string;
  title?: string;
  companyDetails?: { name?: string | null };
  location?: IndeedRawJobLocation;
  formattedLocation?: string;
  jobTypes?: string[];
  jobDescription?: string;
  jobDescriptionHTML?: string;
  originalApplyUrl?: string;
  viewJobLink?: string;
  pubDate?: number;
  expired?: boolean;
}

// Real observed values (Phase 21 live benchmark, 10 real UAE jobs):
// "Temporary", "Permanent", "Part-time", "Full-time", "Contract" — a job
// can list several simultaneously (jobTypes is an array). "Temporary"
// and "Permanent" have no match in this project's employmentType enum
// and are deliberately left unmapped rather than guessed.
const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  "Full-time": "full-time",
  "Part-time": "part-time",
  Contract: "contract",
};

function mapEmploymentType(jobTypes: string[] | undefined): string | null {
  if (!Array.isArray(jobTypes)) return null;
  for (const type of jobTypes) {
    const mapped = EMPLOYMENT_TYPE_MAP[type];
    if (mapped) return mapped;
  }
  return null;
}

function buildRawLocation(location: IndeedRawJobLocation | undefined, formattedLocation: string | undefined): string | null {
  if (location) {
    const parts = [location.city, location.countryName].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
    if (parts.length > 0) return parts.join(", ");
    if (typeof location.formatted?.long === "string" && location.formatted.long.trim()) return location.formatted.long.trim();
  }
  return typeof formattedLocation === "string" && formattedLocation.trim() ? formattedLocation.trim() : null;
}

export function mapIndeedJob(raw: IndeedRawJob): RawProviderJob {
  return {
    externalId: raw.id != null ? String(raw.id) : "",
    title: typeof raw.title === "string" ? stripHtml(raw.title) : null,
    description: stripHtml(raw.jobDescription ?? raw.jobDescriptionHTML),
    companyName: typeof raw.companyDetails?.name === "string" ? raw.companyDetails.name.trim() : null,
    rawLocation: buildRawLocation(raw.location, raw.formattedLocation),
    providerWorkArrangement: null,
    applicationUrl: (typeof raw.originalApplyUrl === "string" ? raw.originalApplyUrl : null) ?? null,
    applicationEmail: null,
    employmentType: mapEmploymentType(raw.jobTypes),
    seniority: null,
    publishedAt: typeof raw.pubDate === "number" ? new Date(raw.pubDate).toISOString() : null,
    sourceLastModifiedAt: null,
    sourceListingUrl: typeof raw.originalApplyUrl === "string" ? raw.originalApplyUrl : null,
  };
}
