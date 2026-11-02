// Phase 2 multi-location job support — pure, offline derivation of a
// job's structured, independently-verified location set from its primary
// rawLocation plus an optional list of additional location strings
// (Workday's real additionalLocations field, confirmed live against
// Murex job JR103091, is the first real case of this). Mirrors the
// one-module-per-concern convention of normalizeLocation.ts/
// jobEligibilityLocation.ts rather than growing either of those files.
//
// Deliberately does NOT decide whether a caller should REPLACE
// previously-stored additional-location rows — that depends on whether
// this run's additionalLocations value is a confirmed array ([] or
// populated) versus unconfirmed (undefined or null), a decision that
// belongs to the ingestion call site, not to this pure function. See
// RawProviderJob.additionalLocations's own doc comment for the full
// four-way contract.
import { normalizeLocation } from "./normalizeLocation.ts";

export interface JobLocationRow {
  countryCode: string;
  city: string | null;
  isPrimary: boolean;
  locationConfidence: "high" | "medium";
}

/**
 * Each candidate string (the primary rawLocation, then every additional
 * location in order) is normalized INDIVIDUALLY via normalizeLocation()
 * — never concatenated into one multi-region string, which would force
 * locationConfidence "low" for the whole thing (normalizeLocation.ts's
 * own isMultiRegion rule) and defeat the entire point of this helper:
 * Paris and Beirut, normalized separately, each resolve cleanly on their
 * own even though neither city-string alone mentions the other.
 *
 * A candidate that cannot resolve to a country at all, or resolves only
 * at "low" confidence, is silently dropped — never inserted as a row.
 * public.job_locations' own CHECK constraint only allows 'high'/'medium'
 * confidence, matching this function's own filter exactly, so a row
 * reaching that table is already guaranteed non-low by construction.
 *
 * Deduplicated by (countryCode, city): the primary candidate is always
 * processed first, so if the primary and an additional location resolve
 * to the identical place, the single resulting row stays marked primary
 * — never duplicated, never demoted.
 *
 * At most one row can ever have isPrimary:true, by construction: only
 * the single `rawLocation` input is ever considered for the primary
 * slot. There is no code path here that can mark a second row primary.
 */
export function deriveJobLocationRows(
  rawLocation: string | null | undefined,
  additionalLocations: readonly string[] | null | undefined
): JobLocationRow[] {
  const candidates: Array<{ text: string; isPrimary: boolean }> = [];
  if (typeof rawLocation === "string" && rawLocation.trim()) {
    candidates.push({ text: rawLocation, isPrimary: true });
  }
  if (Array.isArray(additionalLocations)) {
    for (const text of additionalLocations) {
      if (typeof text === "string" && text.trim()) {
        candidates.push({ text, isPrimary: false });
      }
    }
  }

  const seen = new Map<string, JobLocationRow>();
  for (const { text, isPrimary } of candidates) {
    const normalized = normalizeLocation({ rawLocation: text, providerWorkArrangement: null });
    if (!normalized.countryCode || normalized.locationConfidence === "low") continue;
    const key = `${normalized.countryCode}:${normalized.city ?? ""}`;
    if (!seen.has(key)) {
      seen.set(key, {
        countryCode: normalized.countryCode,
        city: normalized.city,
        isPrimary,
        locationConfidence: normalized.locationConfidence as "high" | "medium",
      });
    }
  }
  return [...seen.values()];
}
