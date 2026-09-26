// Greenhouse job-board API (boards-api.greenhouse.io) adapter. Field
// mapping proven live against real boards during the job-ingestion pilot
// (docs/job-ingestion-pilot.md §2, §5) — this only re-hosts that mapping as
// a pure, reusable, unit-tested TypeScript function instead of an n8n
// Code-node duplicate. Required-field rejection is NOT this module's job —
// that is rawProviderJob.ts's validateRawProviderJob(), so there is exactly
// one place that decides "is this job usable," not two.
import type { RawProviderJob } from "../rawProviderJob.ts";
import { stripHtml } from "./shared.ts";

export interface GreenhouseRawJob {
  id?: number | string;
  title?: string;
  absolute_url?: string;
  content?: string;
  location?: { name?: string };
  first_published?: string;
  updated_at?: string;
}

export function mapGreenhouseJob(raw: GreenhouseRawJob): RawProviderJob {
  const locationName = raw.location?.name ?? null;
  return {
    externalId: raw.id != null ? String(raw.id) : "",
    title: typeof raw.title === "string" ? raw.title : null,
    description: stripHtml(raw.content),
    rawLocation: locationName,
    providerWorkArrangement: locationName && /remote/i.test(locationName) ? "remote" : null,
    applicationUrl: typeof raw.absolute_url === "string" ? raw.absolute_url : null,
    applicationEmail: null,
    employmentType: null,
    seniority: null,
    publishedAt: raw.first_published ?? null,
    sourceLastModifiedAt: raw.updated_at ?? null,
  };
}
