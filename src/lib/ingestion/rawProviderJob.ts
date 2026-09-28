// Generic provider-agnostic ingestion contract: validation + mapping from a
// RawProviderJob (whatever shape a Phase 04 adapter produces after reading
// its own ATS's API) into the exact public.jobs upsert row shape. Pure,
// deterministic, no DB/network access — see docs/OVERNIGHT_BUILD_PROGRESS.md
// Phase 03.
//
// Mirrors the normalization rules already proven in
// docs/job-ingestion-pilot.md §5 (required-field rejection, company_name
// always from the live source, HTML stripped by the caller before this
// point) while adding what the pilot explicitly left as a documented
// limitation: country_code/city/remote_scope are now populated via Phase
// 01's normalizeLocation() instead of being hardcoded null.

import { normalizeLocation, type WorkArrangement } from "./normalizeLocation.ts";

export type JobSourceType =
  | "admin_manual"
  | "career_page"
  | "greenhouse"
  | "lever"
  | "workable"
  | "ashby"
  | "oracle_hcm"
  | "workday"
  | "linkedin"
  // Multi-company feeds (Phase 13): one provider call returns many
  // companies' jobs, so there is no single company_sources row to attach
  // the batch to — see multiCompanyProviderJob.ts and
  // ingestMultiCompanyBatch.ts for how these differ from the company-
  // specific types above.
  | "remoteok"
  | "jobicy"
  | "arbeitnow"
  | "jsearch"
  | "adzuna"
  | "bayt"
  | "gulftalent";

export type EmploymentType = "full-time" | "part-time" | "internship" | "contract";
export type Seniority = "internship" | "entry-level" | "junior" | "mid-level" | "senior";

const EMPLOYMENT_TYPES: readonly EmploymentType[] = ["full-time", "part-time", "internship", "contract"];
const SENIORITIES: readonly Seniority[] = ["internship", "entry-level", "junior", "mid-level", "senior"];

const HTTP_URL_RE = /^https?:\/\//;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Whatever a provider adapter (Phase 04) produces after reading its own ATS's API — not yet validated. */
export interface RawProviderJob {
  externalId: string;
  title: string | null | undefined;
  /** Plain text — stripping HTML is the adapter's responsibility, not this module's. */
  description: string | null | undefined;
  /**
   * Per-job company name — required for multi-company feeds (RemoteOK,
   * Jobicy, ...), where every job in one provider response is a different
   * employer. Company-specific adapters (Greenhouse/Lever/Workable/Ashby)
   * leave this undefined; mapRawProviderJobToJobRow falls back to
   * context.companyName (the live company_sources.company_name) for those.
   * See multiCompanyProviderJob.ts, which requires this field.
   */
  companyName?: string | null;
  /**
   * The provider's own canonical URL for this specific job listing, when
   * distinct from a shared feed URL (e.g. RemoteOK/Jobicy's own listing
   * page, not the employer's application URL). Falls back to
   * context.sourceUrl when absent — this is how per-job provenance is
   * preserved for multi-company feeds without a schema change.
   */
  sourceListingUrl?: string | null;
  rawLocation?: string | null;
  /** Provider-supplied work-arrangement hint (see normalizeLocation.ts). */
  providerWorkArrangement?: string | null;
  applicationUrl?: string | null;
  applicationEmail?: string | null;
  employmentType?: string | null;
  seniority?: string | null;
  /** ISO 8601. */
  publishedAt?: string | null;
  sourceLastModifiedAt?: string | null;
}

export type RawProviderJobRejectReason =
  | "missing_external_id"
  | "missing_title"
  | "missing_description"
  | "missing_application_target"
  | "invalid_application_url"
  | "invalid_application_email"
  | "invalid_employment_type"
  | "invalid_seniority"
  | "linkedin_email_forbidden"
  | "missing_company_name";

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: RawProviderJobRejectReason };

/**
 * Deterministic, pre-DB validation. A job missing a required field, or with
 * a malformed application target, is rejected here — never inserted with a
 * placeholder (docs/job-ingestion-pilot.md §5).
 */
export function validateRawProviderJob(raw: RawProviderJob, sourceType: JobSourceType): ValidationResult {
  if (!raw.externalId || !raw.externalId.trim()) return { valid: false, reason: "missing_external_id" };
  if (!raw.title || !raw.title.trim()) return { valid: false, reason: "missing_title" };
  if (!raw.description || !raw.description.trim()) return { valid: false, reason: "missing_description" };

  const hasUrl = !!raw.applicationUrl?.trim();
  const hasEmail = !!raw.applicationEmail?.trim();
  if (!hasUrl && !hasEmail) return { valid: false, reason: "missing_application_target" };
  if (hasUrl && !HTTP_URL_RE.test(raw.applicationUrl!.trim())) return { valid: false, reason: "invalid_application_url" };
  if (hasEmail && !EMAIL_RE.test(raw.applicationEmail!.trim())) return { valid: false, reason: "invalid_application_email" };

  // AGENTS.md §7 / jobs_linkedin_never_email: a LinkedIn-sourced row may
  // only ever carry a link — never an automated-send email target. Prefer
  // the URL when both are somehow present rather than reject outright.
  if (sourceType === "linkedin" && hasEmail && !hasUrl) return { valid: false, reason: "linkedin_email_forbidden" };

  if (raw.employmentType && !EMPLOYMENT_TYPES.includes(raw.employmentType as EmploymentType)) {
    return { valid: false, reason: "invalid_employment_type" };
  }
  if (raw.seniority && !SENIORITIES.includes(raw.seniority as Seniority)) {
    return { valid: false, reason: "invalid_seniority" };
  }

  return { valid: true };
}

/** Everything the caller already knows about the source this job came from — never guessed. */
export interface JobSourceContext {
  /** Null for multi-company feeds (no single company_sources row) — dedup_scope then falls back to 'type:'||source_type. */
  sourceId: string | null;
  sourceType: JobSourceType;
  /**
   * Always the live company_sources.company_name for company-specific
   * sources — never invented (docs/job-ingestion-pilot.md §5). Omitted for
   * multi-company feeds, where each raw job carries its own companyName
   * instead (see RawProviderJob.companyName).
   */
  companyName?: string;
  sourceUrl?: string | null;
}

/** Exact shape of a public.jobs upsert row this pipeline writes — see database.types.ts's Insert type. */
export interface JobUpsertRow {
  title: string;
  company_name: string;
  description: string;
  location: string | null;
  work_arrangement: WorkArrangement | null;
  employment_type: EmploymentType | null;
  seniority: Seniority | null;
  application_method: "external_link" | "email";
  application_url: string | null;
  application_email: string | null;
  source_type: JobSourceType;
  external_id: string;
  source_url: string | null;
  source_id: string | null;
  country_code: string | null;
  city: string | null;
  remote_scope: string | null;
  published_at: string | null;
  source_last_modified_at: string | null;
  /**
   * A low-confidence location is still ingested (never dropped — Phase 02's
   * eligibility gate is what actually hides it from users), but flagged
   * pending_review rather than shown as a normal active listing.
   */
  status: "active" | "pending_review";
}

/**
 * Maps an already-validated RawProviderJob into a jobs upsert row. Caller
 * must validate first — for multi-company feeds, via
 * validateMultiCompanyProviderJob (multiCompanyProviderJob.ts), which
 * guarantees raw.companyName is present before this function is ever
 * called with context.companyName omitted.
 */
export function mapRawProviderJobToJobRow(raw: RawProviderJob, context: JobSourceContext): JobUpsertRow {
  const location = normalizeLocation({
    rawLocation: raw.rawLocation,
    providerWorkArrangement: raw.providerWorkArrangement,
  });

  const hasUrl = !!raw.applicationUrl?.trim();
  const applicationMethod: "external_link" | "email" = hasUrl ? "external_link" : "email";

  const companyName = context.companyName ?? raw.companyName?.trim();
  if (!companyName) {
    throw new Error("mapRawProviderJobToJobRow: no company name available (context.companyName or raw.companyName required)");
  }

  return {
    title: raw.title!.trim(),
    company_name: companyName,
    description: raw.description!.trim(),
    location: location.rawLocation,
    work_arrangement: location.workArrangement,
    employment_type: (raw.employmentType as EmploymentType | undefined) ?? null,
    seniority: (raw.seniority as Seniority | undefined) ?? null,
    application_method: applicationMethod,
    application_url: hasUrl ? raw.applicationUrl!.trim() : null,
    application_email: hasUrl ? null : raw.applicationEmail!.trim(),
    source_type: context.sourceType,
    external_id: raw.externalId.trim(),
    source_url: raw.sourceListingUrl?.trim() || context.sourceUrl || null,
    source_id: context.sourceId,
    country_code: location.countryCode,
    city: location.city,
    remote_scope: location.remoteScope,
    published_at: raw.publishedAt ?? null,
    source_last_modified_at: raw.sourceLastModifiedAt ?? null,
    status: location.locationConfidence === "low" ? "pending_review" : "active",
  };
}
