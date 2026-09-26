// Hard (deterministic, pre-embedding) eligibility filter: is this job
// allowed to be shown to this user at all, given their plan and job
// preferences? See docs/OVERNIGHT_BUILD_PROGRESS.md Phase 02.
//
// This is a coarse market/plan gate, not the actual match-quality logic
// (Phase 05/06 embeddings + LLM rerank run only on jobs that pass this
// filter). Never uses AI — every branch here is a deterministic plan/
// preference rule, matching AGENTS.md §11 ("Do NOT use LLMs for
// deterministic plan/eligibility logic").
//
// Mirrors real, already-enforced product rules, not invented ones:
// - MVP market is Lebanon-only for Free/Student
//   (supabase/migrations/20260902090010_plan_aware_job_preferences.sql).
// - Pro-only structured international preferences: job_market_coverage
//   ('lebanon_only' | 'remote_lebanon_applicants' | 'remote_mena' |
//   'remote_worldwide'), international_search_enabled, willing_to_relocate,
//   and job_preference_relocation_locations (Gulf relocation markets:
//   SA, QA, KW, AE — supabase/migrations/20260902090000_add_relocation_market_catalog.sql).
//
// Fails closed: a low-confidence or otherwise unresolved location never
// falls through to "eligible" by default.

import { isMenaCountryCode, type LocationConfidence, type WorkArrangement } from "./normalizeLocation.ts";
import type { PlanCode } from "@/lib/plans/types";
import type { JobMarketCoverage } from "@/lib/jobPreferences/types";

export type EligibilityReason =
  | "eligible"
  | "location_confidence_too_low"
  | "work_arrangement_unknown"
  | "onsite_hybrid_outside_lebanon_requires_pro_relocation"
  | "relocation_market_not_selected"
  | "remote_scope_unknown"
  | "remote_scope_excludes_lebanon";

export interface JobEligibilityLocationInput {
  countryCode: string | null;
  workArrangement: WorkArrangement | null;
  remoteScope: string | null;
  locationConfidence: LocationConfidence;
}

export interface JobEligibilityInput {
  job: JobEligibilityLocationInput;
  planCode: PlanCode;
  /**
   * Only ever non-null for a Lebanon-resident Pro user with a remote/
   * flexible work_arrangement preference (server-enforced —
   * enforce_job_preferences_eligibility_trigger). When a Pro user has this
   * null (never explicitly set), this function treats it the same as
   * "remote_lebanon_applicants" — the documented, conservative default:
   * a Pro user who never opted into wider remote coverage sees exactly
   * what a Free/Student user would see, never more.
   */
  jobMarketCoverage: JobMarketCoverage | null;
  internationalSearchEnabled: boolean;
  willingToRelocate: boolean | null;
  /** ISO 3166-1 alpha-2 codes from job_preference_relocation_locations. */
  relocationMarketCountryCodes: readonly string[];
}

export interface JobEligibilityResult {
  eligible: boolean;
  reason: EligibilityReason;
}

function eligible(): JobEligibilityResult {
  return { eligible: true, reason: "eligible" };
}

function ineligible(reason: Exclude<EligibilityReason, "eligible">): JobEligibilityResult {
  return { eligible: false, reason };
}

/** Lebanon is itself MENA, so a MENA-scoped or worldwide remote job always includes Lebanon-based applicants. */
function remoteScopeIncludesLebanon(job: JobEligibilityLocationInput): boolean {
  if (job.countryCode === "LB") return true;
  if (job.remoteScope === "worldwide") return true;
  if (job.remoteScope === "region:mena") return true;
  return false;
}

export function checkJobEligibility(input: JobEligibilityInput): JobEligibilityResult {
  const { job } = input;

  if (job.locationConfidence === "low") {
    return ineligible("location_confidence_too_low");
  }

  if (job.workArrangement === null) {
    return ineligible("work_arrangement_unknown");
  }

  if (job.workArrangement === "onsite" || job.workArrangement === "hybrid") {
    if (job.countryCode === "LB") return eligible();

    // Outside Lebanon, physical presence is required — only the Pro
    // relocation path can make this eligible, never a remote-coverage tier.
    if (input.planCode !== "pro" || !input.internationalSearchEnabled || !input.willingToRelocate) {
      return ineligible("onsite_hybrid_outside_lebanon_requires_pro_relocation");
    }
    if (!job.countryCode || !input.relocationMarketCountryCodes.includes(job.countryCode)) {
      return ineligible("relocation_market_not_selected");
    }
    return eligible();
  }

  // remote | flexible: no physical presence required, gated by
  // job_market_coverage instead of the relocation catalog.
  if (remoteScopeIncludesLebanon(job)) {
    return eligible();
  }

  if (input.planCode !== "pro") {
    return ineligible(job.remoteScope === null ? "remote_scope_unknown" : "remote_scope_excludes_lebanon");
  }

  const coverage = input.jobMarketCoverage ?? "remote_lebanon_applicants";

  if (coverage === "lebanon_only" || coverage === "remote_lebanon_applicants") {
    return ineligible("remote_scope_excludes_lebanon");
  }

  if (coverage === "remote_mena") {
    const menaEligible = job.remoteScope === "region:gcc" || (job.countryCode !== null && isMenaCountryCode(job.countryCode));
    return menaEligible ? eligible() : ineligible("remote_scope_excludes_lebanon");
  }

  // remote_worldwide. Documented assumption (AGENTS.md §17/"conservative
  // reversible implementation, document the assumption, continue"): a
  // determinable scope is shown even when it names a single non-MENA
  // country (e.g. "Remote - US only") — this tier means "show me the
  // widest net of remote jobs," not "guarantee I'm personally eligible for
  // every one." A genuinely unknown scope still fails closed; this
  // function never claims certainty it doesn't have.
  return job.remoteScope === null ? ineligible("remote_scope_unknown") : eligible();
}
