// Workable widget API (apply.workable.com/api/v1/widget/accounts/<slug>)
// adapter. Field mapping proven live during the job-ingestion pilot
// (docs/job-ingestion-pilot.md §2, §5) — re-hosted as a pure, reusable,
// unit-tested function. See greenhouse.ts's header for why required-field
// rejection lives only in rawProviderJob.ts, never duplicated here.
import type { RawProviderJob } from "../rawProviderJob.ts";
import { EMPLOYMENT_MAP, stripHtml } from "./shared.ts";

export interface WorkableRawJob {
  shortcode?: string;
  title?: string;
  application_url?: string;
  url?: string;
  description?: string;
  employment_type?: string;
  city?: string;
  country?: string;
  telecommuting?: boolean;
  published_on?: string;
}

export function mapWorkableJob(raw: WorkableRawJob): RawProviderJob {
  const empType = raw.employment_type?.toLowerCase() ?? null;
  const locationParts = [raw.city, raw.country].filter((v): v is string => typeof v === "string" && v.trim().length > 0);

  return {
    externalId: typeof raw.shortcode === "string" ? raw.shortcode : "",
    title: typeof raw.title === "string" ? raw.title : null,
    description: stripHtml(raw.description),
    rawLocation: locationParts.length > 0 ? locationParts.join(", ") : null,
    providerWorkArrangement: raw.telecommuting === true ? "remote" : null,
    applicationUrl: raw.application_url ?? raw.url ?? null,
    applicationEmail: null,
    employmentType: empType && EMPLOYMENT_MAP[empType] ? EMPLOYMENT_MAP[empType] : null,
    seniority: null,
    publishedAt: typeof raw.published_on === "string" && raw.published_on ? new Date(raw.published_on).toISOString() : null,
    sourceLastModifiedAt: null,
  };
}
