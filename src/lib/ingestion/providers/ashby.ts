// Ashby posting-api job-board adapter (Phase 13, Tier A — company-specific,
// same shape as greenhouse.ts/lever.ts/workable.ts). Field mapping
// confirmed live this phase against a real board (GET
// https://api.ashbyhq.com/posting-api/job-board/the-studio — see
// docs/PROVIDER_EXPANSION_IMPLEMENTATION.md). companyName is intentionally
// absent here: this is a company-specific source, so ingestSourceBatch.ts
// supplies it from the live company_sources row, exactly like the other
// three Tier-A adapters.
import type { RawProviderJob } from "../rawProviderJob.ts";
import { stripHtml } from "./shared.ts";

export interface AshbyRawJob {
  id?: string;
  title?: string;
  location?: string;
  employmentType?: string;
  workplaceType?: string;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionHtml?: string;
}

const WORKPLACE_TYPE_MAP: Record<string, string> = {
  Remote: "remote",
  Hybrid: "hybrid",
  OnSite: "onsite",
};

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  FullTime: "full-time",
  PartTime: "part-time",
  Intern: "internship",
  Contract: "contract",
  Temporary: "contract",
};

export function mapAshbyJob(raw: AshbyRawJob): RawProviderJob {
  return {
    externalId: typeof raw.id === "string" ? raw.id : "",
    title: typeof raw.title === "string" ? raw.title : null,
    description: stripHtml(raw.descriptionHtml),
    rawLocation: raw.location ?? null,
    providerWorkArrangement: raw.workplaceType ? (WORKPLACE_TYPE_MAP[raw.workplaceType] ?? null) : null,
    applicationUrl: (typeof raw.applyUrl === "string" ? raw.applyUrl : null) ?? (typeof raw.jobUrl === "string" ? raw.jobUrl : null),
    applicationEmail: null,
    employmentType: raw.employmentType ? (EMPLOYMENT_TYPE_MAP[raw.employmentType] ?? null) : null,
    seniority: null,
    publishedAt: raw.publishedAt ?? null,
    sourceLastModifiedAt: null,
    sourceListingUrl: raw.jobUrl ?? null,
  };
}
