// RemoteOK public API adapter (Phase 13, Tier D — multi-company feed).
// Field mapping confirmed live this phase against GET
// https://remoteok.com/api (see docs/PROVIDER_EXPANSION_IMPLEMENTATION.md).
// Unlike the Tier-A adapters, this sets companyName per job — there is no
// company_sources row for a many-companies-per-call feed (see
// multiCompanyProviderJob.ts). RemoteOK's own ToS requires attribution/a
// link back to the source URL rather than a technical rate limit — url and
// apply_url both point at the remoteok.com listing page, not the employer
// directly, which is RemoteOK's own model (confirmed live), not a mapping
// gap on this adapter's part.
//
// RemoteOK's response array's first element is always a metadata/legend
// object (last_updated/legal text, no job fields) — the caller (the
// internal endpoint) is responsible for skipping it before calling this
// per-item adapter, same as every other provider's "here is one raw job"
// contract.
import type { RawProviderJob } from "../rawProviderJob.ts";
import { stripHtml } from "./shared.ts";

export interface RemoteOkRawJob {
  id?: string | number;
  position?: string;
  description?: string;
  company?: string;
  location?: string;
  apply_url?: string;
  url?: string;
  date?: string;
}

export function mapRemoteOkJob(raw: RemoteOkRawJob): RawProviderJob {
  return {
    externalId: raw.id != null ? String(raw.id) : "",
    title: typeof raw.position === "string" ? raw.position : null,
    description: stripHtml(raw.description),
    companyName: typeof raw.company === "string" ? raw.company.trim() : null,
    rawLocation: raw.location && raw.location.trim() ? raw.location : null,
    // RemoteOK lists remote jobs exclusively — the field is a secondary
    // "location the role is anchored to for timezone/eligibility"
    // signal, often blank, never onsite.
    providerWorkArrangement: "remote",
    applicationUrl: (typeof raw.apply_url === "string" ? raw.apply_url : null) ?? (typeof raw.url === "string" ? raw.url : null),
    applicationEmail: null,
    employmentType: null,
    seniority: null,
    publishedAt: raw.date ?? null,
    sourceLastModifiedAt: null,
    sourceListingUrl: raw.url ?? null,
  };
}
