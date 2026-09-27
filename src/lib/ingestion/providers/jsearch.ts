// JSearch (RapidAPI) adapter (Phase 13, Tier C — multi-company feed).
//
// *** NOT LIVE-VERIFIED — BLOCKED_ON_CREDENTIAL ***
// No JSEARCH_API_KEY is configured anywhere in this project (see
// docs/OVERNIGHT_CREDENTIALS_REQUIRED.md), so this mapping has never been
// exercised against a real API response. Field names below follow
// JSearch's publicly documented response schema, not a verified live call.
// Before flipping providerConfig.ts's jsearch.enabled to true: obtain a
// key, make one real request, and confirm every field name below still
// matches the actual response — do not trust this file alone as proof the
// integration works (AGENTS.md §30: validate structured provider output
// against a real schema, not an assumption).
import type { RawProviderJob } from "../rawProviderJob.ts";
import { stripHtml } from "./shared.ts";

export interface JSearchRawJob {
  job_id?: string;
  job_title?: string;
  employer_name?: string;
  job_description?: string;
  job_apply_link?: string;
  job_city?: string;
  job_country?: string;
  job_employment_type?: string;
  job_is_remote?: boolean;
  job_posted_at_datetime_utc?: string;
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  FULLTIME: "full-time",
  PARTTIME: "part-time",
  CONTRACTOR: "contract",
  INTERN: "internship",
};

export function mapJSearchJob(raw: JSearchRawJob): RawProviderJob {
  const locationParts = [raw.job_city, raw.job_country].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return {
    externalId: typeof raw.job_id === "string" ? raw.job_id : "",
    title: typeof raw.job_title === "string" ? raw.job_title : null,
    description: stripHtml(raw.job_description),
    companyName: typeof raw.employer_name === "string" ? raw.employer_name.trim() : null,
    rawLocation: locationParts.length > 0 ? locationParts.join(", ") : null,
    providerWorkArrangement: raw.job_is_remote === true ? "remote" : null,
    applicationUrl: typeof raw.job_apply_link === "string" ? raw.job_apply_link : null,
    applicationEmail: null,
    employmentType: raw.job_employment_type ? (EMPLOYMENT_TYPE_MAP[raw.job_employment_type] ?? null) : null,
    seniority: null,
    publishedAt: raw.job_posted_at_datetime_utc ?? null,
    sourceLastModifiedAt: null,
    sourceListingUrl: typeof raw.job_apply_link === "string" ? raw.job_apply_link : null,
  };
}
