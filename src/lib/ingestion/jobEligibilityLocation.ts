// Bridges the real, already-persisted public.jobs row shape to the
// location shape checkJobEligibility.ts needs, reusing Phase 01's
// normalizeLocation() as a fallback derivation — not a second source of
// truth. See docs/OVERNIGHT_BUILD_PROGRESS.md Phase 02.
//
// public.jobs already has structured, constrained columns for this
// (country_code FK's public.countries, work_arrangement is check-
// constrained, remote_scope is free-form — see
// supabase/migrations/20260809090030_create_jobs.sql and
// 20260914120000_add_jobs_freshness_and_geography.sql). When those are
// already populated (e.g. curated admin job entry), they are trusted
// directly. normalizeLocation() only runs against the free-text
// `location` column as a fallback for rows ingested with just raw text.

import { normalizeLocation, type LocationConfidence, type WorkArrangement } from "./normalizeLocation.ts";

export interface JobLocationColumns {
  location: string | null;
  country_code: string | null;
  city: string | null;
  work_arrangement: string | null;
  remote_scope: string | null;
}

export interface EligibilityLocation {
  countryCode: string | null;
  workArrangement: WorkArrangement | null;
  remoteScope: string | null;
  locationConfidence: LocationConfidence;
}

function asWorkArrangement(value: string | null): WorkArrangement | null {
  if (value === "remote" || value === "onsite" || value === "hybrid" || value === "flexible") {
    return value;
  }
  return null;
}

export function deriveEligibilityLocation(job: JobLocationColumns): EligibilityLocation {
  const workArrangement = asWorkArrangement(job.work_arrangement);

  // Structured columns already populated (curated entry, or a prior
  // ingestion run already wrote normalized values) — trust them; only
  // downgrade confidence for the same "remote with no scope" ambiguity
  // normalizeLocation itself treats as medium, never as an outright guess.
  if (job.country_code) {
    const isAmbiguousRemote = workArrangement === "remote" && !job.remote_scope;
    return {
      countryCode: job.country_code,
      workArrangement,
      remoteScope: workArrangement === "remote" ? job.remote_scope : null,
      locationConfidence: isAmbiguousRemote ? "medium" : "high",
    };
  }

  if (workArrangement === "remote" && job.remote_scope) {
    // Remote with an explicit scope but no resolved country (e.g.
    // "region:mena" style curated scope with no single country) — a real
    // signal, not an unknown.
    return {
      countryCode: null,
      workArrangement,
      remoteScope: job.remote_scope,
      locationConfidence: "high",
    };
  }

  // No trustworthy structured data — fall back to deriving from the raw
  // free-text location, same as a freshly-ingested provider row would be.
  const normalized = normalizeLocation({ rawLocation: job.location, providerWorkArrangement: job.work_arrangement });
  return {
    countryCode: normalized.countryCode,
    workArrangement: normalized.workArrangement,
    remoteScope: normalized.remoteScope,
    locationConfidence: normalized.locationConfidence,
  };
}
