// Lever postings API (api.lever.co/v0/postings) adapter. Field mapping
// proven live during the job-ingestion pilot (docs/job-ingestion-pilot.md
// §2, §5) — re-hosted as a pure, reusable, unit-tested function. See
// greenhouse.ts's header for why required-field rejection lives only in
// rawProviderJob.ts, never duplicated here.
import type { RawProviderJob } from "../rawProviderJob.ts";
import { EMPLOYMENT_MAP, WORKPLACE_MAP } from "./shared.ts";

export interface LeverRawJob {
  id?: string;
  text?: string;
  applyUrl?: string;
  hostedUrl?: string;
  descriptionPlain?: string;
  categories?: {
    location?: string;
    commitment?: string;
    workplaceType?: string;
  };
  createdAt?: number;
}

export function mapLeverJob(raw: LeverRawJob): RawProviderJob {
  const commitment = raw.categories?.commitment?.toLowerCase() ?? null;
  const workplaceType = raw.categories?.workplaceType?.toLowerCase() ?? null;

  return {
    externalId: typeof raw.id === "string" ? raw.id : "",
    title: typeof raw.text === "string" ? raw.text : null,
    description: typeof raw.descriptionPlain === "string" ? raw.descriptionPlain.trim() : null,
    rawLocation: raw.categories?.location ?? null,
    providerWorkArrangement: workplaceType && WORKPLACE_MAP[workplaceType] ? WORKPLACE_MAP[workplaceType] : null,
    applicationUrl: raw.applyUrl ?? raw.hostedUrl ?? null,
    applicationEmail: null,
    employmentType: commitment && EMPLOYMENT_MAP[commitment] ? EMPLOYMENT_MAP[commitment] : null,
    seniority: null,
    publishedAt: typeof raw.createdAt === "number" ? new Date(raw.createdAt).toISOString() : null,
    sourceLastModifiedAt: null,
  };
}
