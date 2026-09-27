// Jobicy public API adapter (Phase 13, Tier D — multi-company feed). Field
// mapping confirmed live this phase against GET
// https://jobicy.com/api/v2/remote-jobs?count=N (see
// docs/PROVIDER_EXPANSION_IMPLEMENTATION.md). companyName is set per job —
// see multiCompanyProviderJob.ts.
import type { RawProviderJob } from "../rawProviderJob.ts";
import { stripHtml } from "./shared.ts";

export interface JobicyRawJob {
  id?: number | string;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  jobGeo?: string;
  jobType?: string[];
  jobLevel?: string;
  jobDescription?: string;
  pubDate?: string;
}

const JOB_TYPE_MAP: Record<string, string> = {
  "Full-Time": "full-time",
  "Part-Time": "part-time",
  Contract: "contract",
  Freelance: "contract",
  Internship: "internship",
};

// jobLevel values confirmed live this phase: "Senior", "Director", "Any",
// and others not yet observed. Only map the ones that clearly correspond
// to public.jobs.seniority's enum — anything else (including "Any",
// "Director", which has no equivalent in our enum) stays null rather than
// guess a nearest-fit value.
const JOB_LEVEL_MAP: Record<string, string> = {
  Entry: "entry-level",
  Junior: "junior",
  "Mid-Level": "mid-level",
  Senior: "senior",
  Internship: "internship",
};

export function mapJobicyJob(raw: JobicyRawJob): RawProviderJob {
  return {
    externalId: raw.id != null ? String(raw.id) : "",
    title: typeof raw.jobTitle === "string" ? raw.jobTitle : null,
    description: stripHtml(raw.jobDescription),
    companyName: typeof raw.companyName === "string" ? raw.companyName.trim() : null,
    rawLocation: raw.jobGeo && raw.jobGeo.trim() ? raw.jobGeo : null,
    providerWorkArrangement: "remote",
    applicationUrl: typeof raw.url === "string" ? raw.url : null,
    applicationEmail: null,
    employmentType: raw.jobType?.[0] ? (JOB_TYPE_MAP[raw.jobType[0]] ?? null) : null,
    seniority: raw.jobLevel ? (JOB_LEVEL_MAP[raw.jobLevel] ?? null) : null,
    publishedAt: raw.pubDate ?? null,
    sourceLastModifiedAt: null,
    sourceListingUrl: raw.url ?? null,
  };
}
