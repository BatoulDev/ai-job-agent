// Oracle Cloud Recruiting (Oracle HCM) adapter (Phase 16, Tier A — company-
// specific, same shape as greenhouse.ts/lever.ts/workable.ts/ashby.ts).
// Field mapping confirmed LIVE this phase against a real tenant (American
// University of Beirut Medical Center, siteNumber CX_2) — see
// docs/LEBANON_GULF_SOURCE_RESEARCH.md §3: a direct, unauthenticated GET to
// `{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?finder=
// findReqs;siteNumber={site}&expand=requisitionList` returned real job data
// (6 real Lebanon nursing/medical postings), and
// `{host}/hcmUI/CandidateExperience/en/sites/{site}/job/{Id}` returned a
// real 200 candidate-facing job page (confirmed via `og:title` matching the
// requisition's own Title) — this is the real, public, canonical apply URL
// shape, not invented. companyName is intentionally absent here:
// ingestSourceBatch.ts supplies it from the live company_sources row,
// exactly like the other Tier-A adapters.
import type { RawProviderJob } from "../rawProviderJob.ts";
import { stripHtml } from "./shared.ts";

export interface OracleHcmRawJob {
  Id?: string | number;
  Title?: string;
  ShortDescriptionStr?: string;
  PostedDate?: string;
  PrimaryLocation?: string;
  PrimaryLocationCountry?: string;
  WorkplaceType?: string;
  WorkplaceTypeCode?: string;
  ContractType?: string;
  // Oracle's own REST response carries no candidate-facing URL at all (only
  // internal `hcmRestApi` self-links) — the real public apply URL lives at
  // a completely different host path (`/hcmUI/CandidateExperience/...`,
  // confirmed live this phase). Since ProviderAdapter is a single-argument
  // (raw) => RawProviderJob function (no per-batch context parameter, by
  // design — see providers/index.ts), the fetch step stamps this field onto
  // every raw item before it reaches this adapter, exactly like every other
  // multi-field-enrichment case in this codebase (e.g. RemoteOK's own
  // sourceListingUrl). Required for a non-null applicationUrl.
  candidateSiteUrl?: string;
}

// Confirmed real values documented by Oracle's own recruiting-cloud REST
// API reference; the one live tenant sampled this phase (AUBMC) returned
// null/empty for every job (all on-site hospital roles), so this map is
// built from Oracle's own documented vocabulary, not a live-observed
// sample — same "documented schema, not yet exhaustively observed" caveat
// this project already applies to jsearch.ts/adzuna.ts.
const WORKPLACE_TYPE_MAP: Record<string, string> = {
  REMOTE: "remote",
  HYBRID: "hybrid",
  ON_SITE: "onsite",
  ONSITE: "onsite",
};

const CONTRACT_TYPE_MAP: Record<string, string> = {
  TEMPORARY: "contract",
  CONTRACTOR: "contract",
  INTERN: "internship",
  PART_TIME: "part-time",
  FULL_TIME: "full-time",
};

/** `PrimaryLocation`/`PrimaryLocationCountry` are both present on every real sampled job; prefer the fuller locality+country text when available. */
function buildRawLocation(raw: OracleHcmRawJob): string | null {
  if (typeof raw.PrimaryLocation === "string" && raw.PrimaryLocation.trim()) return raw.PrimaryLocation.trim();
  if (typeof raw.PrimaryLocationCountry === "string" && raw.PrimaryLocationCountry.trim()) return raw.PrimaryLocationCountry.trim();
  return null;
}

export function mapOracleHcmJob(raw: OracleHcmRawJob): RawProviderJob {
  const externalId = raw.Id != null ? String(raw.Id) : "";
  const siteUrl = typeof raw.candidateSiteUrl === "string" ? raw.candidateSiteUrl.replace(/\/$/, "") : null;
  const applyUrl = externalId && siteUrl ? `${siteUrl}/job/${externalId}` : null;
  const workplaceCode = (raw.WorkplaceTypeCode ?? raw.WorkplaceType ?? "").toUpperCase();

  return {
    externalId,
    title: typeof raw.Title === "string" ? raw.Title : null,
    description: stripHtml(raw.ShortDescriptionStr),
    rawLocation: buildRawLocation(raw),
    providerWorkArrangement: workplaceCode ? (WORKPLACE_TYPE_MAP[workplaceCode] ?? null) : null,
    applicationUrl: applyUrl,
    applicationEmail: null,
    employmentType: raw.ContractType ? (CONTRACT_TYPE_MAP[raw.ContractType.toUpperCase()] ?? null) : null,
    seniority: null,
    publishedAt: raw.PostedDate ?? null,
    sourceLastModifiedAt: null,
    sourceListingUrl: applyUrl,
  };
}
