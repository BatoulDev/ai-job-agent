// Workday adapter (Phase 16, Tier A — company-specific, same shape as
// greenhouse.ts/lever.ts/workable.ts/ashby.ts/oracle-hcm.ts).
//
// *** MAPPING LOGIC ONLY — NOT WIRED INTO THE INGESTION WORKFLOW THIS PHASE ***
// Confirmed live this phase (docs/LEBANON_GULF_SOURCE_RESEARCH.md §3): a
// real POST to `https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/
// {site}/jobs` with body `{"appliedFacets":{},"limit":N,"offset":0,
// "searchText":""}` returns real job data, no auth (tested against Murex's
// real tenant: 68 real jobs). The real, confirmed field shape below is
// `{total, jobPostings:[{title, externalPath, locationsText, postedOn,
// bulletFields}], facets}` — and critically, **the list endpoint carries no
// job description at all**. The real, public, canonical apply URL
// (`https://{tenant}.wd{N}.myworkdayjobs.com/{site}{externalPath}`) was also
// confirmed live (a real 200 page). Getting a description requires a
// SECOND, per-job HTTP call to that same detail URL — an architecture this
// phase does not implement (every other Tier-A source's list response
// already carries its own description, so `Fetch Source Jobs`'s one-GET-
// per-source shape has never needed a second fetch stage before). Until
// that per-job detail fetch exists, `description` is always null here and
// `validateRawProviderJob` will correctly reject every Workday job as
// `missing_description`, never silently accept an empty one — this is the
// honest current state, not a bug. See docs/LEBANON_GULF_SOURCE_RESEARCH.md
// §16 and the Phase 16 implementation notes for the real follow-up needed.
import type { RawProviderJob } from "../rawProviderJob.ts";
import { stripHtml } from "./shared.ts";

export interface WorkdayRawJob {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
  // Not present in the real list response observed this phase — only
  // populated if/when a future per-job detail fetch supplies it. Optional
  // and honest: never fabricated.
  description?: string;
  // Stamped by the fetch step (same pattern as oracle-hcm.ts's
  // candidateSiteUrl) so this single-argument (raw) => RawProviderJob
  // function can build a real, non-invented apply URL — the tenant base
  // (`https://{tenant}.wd{N}.myworkdayjobs.com/{site}`) is not itself part
  // of any single job record.
  tenantSiteBaseUrl?: string;
}

function extractRequisitionId(raw: WorkdayRawJob): string {
  // bulletFields[0] is the requisition ID (e.g. "JR103210") in every real
  // job observed this phase — confirmed live, not a documented assumption.
  // Falls back to externalPath (still stable and unique per real posting)
  // if bulletFields is ever absent/malformed, never invents an ID.
  const first = raw.bulletFields?.[0];
  if (typeof first === "string" && first.trim()) return first.trim();
  return typeof raw.externalPath === "string" ? raw.externalPath.trim() : "";
}

export function mapWorkdayJob(raw: WorkdayRawJob): RawProviderJob {
  const applyUrl = raw.tenantSiteBaseUrl && typeof raw.externalPath === "string" ? `${raw.tenantSiteBaseUrl.replace(/\/$/, "")}${raw.externalPath}` : null;

  return {
    externalId: extractRequisitionId(raw),
    title: typeof raw.title === "string" ? raw.title : null,
    description: stripHtml(raw.description),
    rawLocation: typeof raw.locationsText === "string" && raw.locationsText.trim() ? raw.locationsText.trim() : null,
    providerWorkArrangement: null,
    applicationUrl: applyUrl,
    applicationEmail: null,
    employmentType: null,
    seniority: null,
    // postedOn is relative human text ("Posted 2 Days Ago") in the real
    // response, not a parseable ISO date — never fabricated into one.
    publishedAt: null,
    sourceLastModifiedAt: null,
    sourceListingUrl: applyUrl,
  };
}
