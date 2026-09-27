// Arbeitnow public API adapter (Phase 13, Tier D — multi-company feed).
// Field mapping confirmed live this phase against GET
// https://www.arbeitnow.com/api/job-board-api (see
// docs/PROVIDER_EXPANSION_IMPLEMENTATION.md). companyName is set per job —
// see multiCompanyProviderJob.ts.
//
// Arbeitnow's response is dominated by DACH-region onsite listings — only
// remote:true items are relevant to this project's international-remote
// lane. Filtering to remote:true is done by the caller (an n8n Filter node
// before this adapter is invoked, or the internal endpoint), not this
// per-item mapping function, matching every other provider's "map exactly
// what you're given" contract.
//
// Arbeitnow's job objects have no separate numeric id field — `slug` is
// the stable, unique-per-posting identifier (confirmed via the live
// response: distinct per job, embedded in the job's own url).
import type { RawProviderJob } from "../rawProviderJob.ts";
import { stripHtml } from "./shared.ts";

export interface ArbeitnowRawJob {
  slug?: string;
  title?: string;
  company_name?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  job_types?: string[];
  location?: string;
  created_at?: number;
}

const JOB_TYPE_MAP: Record<string, string> = {
  "Full-time": "full-time",
  "Part-time": "part-time",
  Contract: "contract",
  Freelance: "contract",
  Internship: "internship",
  "Working student": "internship",
};

export function mapArbeitnowJob(raw: ArbeitnowRawJob): RawProviderJob {
  return {
    externalId: typeof raw.slug === "string" ? raw.slug : "",
    title: typeof raw.title === "string" ? raw.title : null,
    description: stripHtml(raw.description),
    companyName: typeof raw.company_name === "string" ? raw.company_name.trim() : null,
    rawLocation: raw.location ?? null,
    providerWorkArrangement: raw.remote === true ? "remote" : null,
    applicationUrl: typeof raw.url === "string" ? raw.url : null,
    applicationEmail: null,
    employmentType: raw.job_types?.[0] ? (JOB_TYPE_MAP[raw.job_types[0]] ?? null) : null,
    seniority: null,
    publishedAt: typeof raw.created_at === "number" ? new Date(raw.created_at * 1000).toISOString() : null,
    sourceLastModifiedAt: null,
    sourceListingUrl: raw.url ?? null,
  };
}
