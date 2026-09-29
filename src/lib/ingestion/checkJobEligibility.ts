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
//   Pro market-coverage model (see docs/PRODUCT_MATCHING_RULES.md
//   "Market coverage"): the canonical, only-ever-derived Pro remote tier
//   is 'remote_worldwide' — save_job_preferences never derives
//   'remote_mena' or 'lebanon_only', and 'remote_mena' can no longer be
//   written at all (20260930120000_retire_remote_mena_coverage_tier.sql).
//   The remote_mena branches below exist solely to evaluate any
//   pre-existing legacy row under its original (narrower, GCC/MENA-only)
//   semantics — never remove them without a migration proving no such row
//   remains.
//
// Fails closed: a low-confidence or otherwise unresolved location never
// falls through to "eligible" by default.
//
// FOUNDER DECISION (Phase 21 follow-up, see
// docs/LEBANON_LIVE_SOURCE_EXPANSION.md §5 and
// docs/PRODUCT_MATCHING_RULES.md "Work arrangement"): missing
// work-arrangement metadata alone must never be a rejection reason. Real
// live-provider data (Bayt/GulfTalent/Indeed) showed most real postings
// never state onsite/hybrid/remote explicitly — rejecting them lost
// otherwise-relevant jobs. The rule going forward, deliberately hard to
// reverse by accident:
//   - job arrangement known + user preference known + same value (or
//     either side is "flexible") -> match, normal eligibility applies.
//   - job arrangement known + user preference known + different value ->
//     CONFLICT, always ineligible. This is unchanged/new-but-intentional:
//     explicit preferences are never weakened.
//   - job arrangement unknown, OR user has no preference set -> UNKNOWN.
//     Never inferred as onsite/hybrid/remote. Eligibility falls back to
//     evaluating the job under both the "requires physical presence" and
//     the "remote" geographic rules, and is granted if EITHER would
//     independently make the job eligible — the same principle as the
//     motivating example (a Beirut job with no stated arrangement is
//     eligible for a Lebanon-market user under every existing branch
//     already, known or not). If NEITHER branch would grant eligibility
//     (e.g. a Student-plan user and a job outside Lebanon — ineligible on
//     plan/geography grounds regardless of arrangement), the job stays
//     ineligible; unknown arrangement never overrides an unrelated hard
//     geographic/plan rule, it only stops being an independent rejection
//     reason on its own.

import { isMenaCountryCode, type LocationConfidence, type WorkArrangement } from "./normalizeLocation.ts";
import type { PlanCode } from "@/lib/plans/types";
import type { JobMarketCoverage } from "@/lib/jobPreferences/types";

export type EligibilityReason =
  | "eligible"
  | "location_confidence_too_low"
  | "work_arrangement_conflict"
  | "work_arrangement_unknown_and_ineligible"
  | "onsite_hybrid_outside_lebanon_requires_pro_relocation"
  | "relocation_market_not_selected"
  | "remote_scope_unknown"
  | "remote_scope_excludes_lebanon";

/**
 * Conceptual model the founder decision asks for, kept distinct from a
 * boolean eligible/ineligible: "unknown" is its own state, never coerced
 * into "match" or "conflict". Always computed, even when the job is
 * ultimately ineligible for an unrelated (geographic/plan) reason, so
 * callers (e.g. a UI label) can say "work arrangement not specified"
 * without re-deriving it themselves.
 */
export type WorkArrangementStatus = "match" | "conflict" | "unknown";

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
   * The user's job_preferences.work_arrangement. Null means the user has
   * not stated a preference — treated as "unknown" (nothing to match or
   * conflict against), never as an implicit "any arrangement is fine"
   * that would somehow rank differently from a real preference.
   */
  preferredWorkArrangement: WorkArrangement | null;
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
  /** See WorkArrangementStatus — always populated, independent of `eligible`. */
  workArrangementStatus: WorkArrangementStatus;
}

function eligible(status: WorkArrangementStatus): JobEligibilityResult {
  return { eligible: true, reason: "eligible", workArrangementStatus: status };
}

function ineligible(reason: Exclude<EligibilityReason, "eligible">, status: WorkArrangementStatus): JobEligibilityResult {
  return { eligible: false, reason, workArrangementStatus: status };
}

/** Lebanon is itself MENA, so a MENA-scoped or worldwide remote job always includes Lebanon-based applicants. */
function remoteScopeIncludesLebanon(job: JobEligibilityLocationInput): boolean {
  if (job.countryCode === "LB") return true;
  if (job.remoteScope === "worldwide") return true;
  if (job.remoteScope === "region:mena") return true;
  return false;
}

/**
 * Explicit user preference vs. explicit job arrangement, per the founder
 * decision's literal rule: same value -> match, different value ->
 * conflict. "flexible" on either side is always compatible — by
 * definition it means "open to any of these", not a fourth arrangement
 * that could itself conflict. Never invoked with a null on either side;
 * callers treat that as "unknown" before reaching here.
 */
function compareKnownArrangement(job: WorkArrangement, preferred: WorkArrangement): "match" | "conflict" {
  if (job === preferred) return "match";
  if (job === "flexible" || preferred === "flexible") return "match";
  return "conflict";
}

/** Onsite/hybrid geographic rule, unchanged from before this decision — extracted so the "unknown" branch can evaluate it hypothetically. */
function evaluatePhysicalPresenceEligibility(job: JobEligibilityLocationInput, input: JobEligibilityInput): boolean {
  if (job.countryCode === "LB") return true;
  if (input.planCode !== "pro" || !input.internationalSearchEnabled || !input.willingToRelocate) return false;
  if (!job.countryCode || !input.relocationMarketCountryCodes.includes(job.countryCode)) return false;
  return true;
}

/** Remote/flexible geographic rule, unchanged from before this decision — extracted so the "unknown" branch can evaluate it hypothetically. */
function evaluateRemoteEligibility(job: JobEligibilityLocationInput, input: JobEligibilityInput): boolean {
  if (remoteScopeIncludesLebanon(job)) return true;
  if (input.planCode !== "pro") return false;

  const coverage = input.jobMarketCoverage ?? "remote_lebanon_applicants";
  if (coverage === "lebanon_only" || coverage === "remote_lebanon_applicants") return false;
  if (coverage === "remote_mena") {
    // Legacy tier — never derived for a new row (see this file's header).
    // Kept so any pre-existing row still behaves per its original, narrower
    // (GCC/MENA-only) semantics, not silently widened to remote_worldwide.
    return job.remoteScope === "region:gcc" || (job.countryCode !== null && isMenaCountryCode(job.countryCode));
  }
  // remote_worldwide — the canonical, only-ever-derived Pro remote tier.
  // A genuinely unknown scope still fails closed.
  return job.remoteScope !== null;
}

export function checkJobEligibility(input: JobEligibilityInput): JobEligibilityResult {
  const { job } = input;

  if (job.locationConfidence === "low") {
    return ineligible("location_confidence_too_low", "unknown");
  }

  // Nullish, not strict-null, checks: a caller that omits the (optional in
  // practice) preference field entirely passes `undefined`, which must be
  // treated identically to an explicit `null` — never as a real, distinct
  // preference value that could spuriously "conflict" with a known job
  // arrangement.
  const jobArrangement = job.workArrangement ?? null;
  const preferredArrangement = input.preferredWorkArrangement ?? null;

  const arrangementStatus: WorkArrangementStatus =
    jobArrangement === null || preferredArrangement === null ? "unknown" : compareKnownArrangement(jobArrangement, preferredArrangement);

  if (arrangementStatus === "conflict") {
    return ineligible("work_arrangement_conflict", "conflict");
  }

  if (jobArrangement === null) {
    // Never inferred — evaluate both geographic interpretations and grant
    // eligibility if either would independently succeed. This can never
    // make a Student-plan or non-relocating Pro user eligible for a job
    // outside Lebanon: both branches already require that independently
    // of arrangement, so this only stops "unknown" from being its own
    // rejection reason, never loosens plan/geography.
    if (evaluatePhysicalPresenceEligibility(job, input) || evaluateRemoteEligibility(job, input)) {
      return eligible(arrangementStatus);
    }
    return ineligible("work_arrangement_unknown_and_ineligible", arrangementStatus);
  }

  if (job.workArrangement === "onsite" || job.workArrangement === "hybrid") {
    if (job.countryCode === "LB") return eligible(arrangementStatus);

    // Outside Lebanon, physical presence is required — only the Pro
    // relocation path can make this eligible, never a remote-coverage tier.
    if (input.planCode !== "pro" || !input.internationalSearchEnabled || !input.willingToRelocate) {
      return ineligible("onsite_hybrid_outside_lebanon_requires_pro_relocation", arrangementStatus);
    }
    if (!job.countryCode || !input.relocationMarketCountryCodes.includes(job.countryCode)) {
      return ineligible("relocation_market_not_selected", arrangementStatus);
    }
    return eligible(arrangementStatus);
  }

  // remote | flexible: no physical presence required, gated by
  // job_market_coverage instead of the relocation catalog.
  if (remoteScopeIncludesLebanon(job)) {
    return eligible(arrangementStatus);
  }

  if (input.planCode !== "pro") {
    return ineligible(job.remoteScope === null ? "remote_scope_unknown" : "remote_scope_excludes_lebanon", arrangementStatus);
  }

  const coverage = input.jobMarketCoverage ?? "remote_lebanon_applicants";

  if (coverage === "lebanon_only" || coverage === "remote_lebanon_applicants") {
    return ineligible("remote_scope_excludes_lebanon", arrangementStatus);
  }

  if (coverage === "remote_mena") {
    // Legacy tier — see evaluateRemoteEligibility's identical branch above.
    const menaEligible = job.remoteScope === "region:gcc" || (job.countryCode !== null && isMenaCountryCode(job.countryCode));
    return menaEligible ? eligible(arrangementStatus) : ineligible("remote_scope_excludes_lebanon", arrangementStatus);
  }

  // remote_worldwide. Documented assumption (AGENTS.md §17/"conservative
  // reversible implementation, document the assumption, continue"): a
  // determinable scope is shown even when it names a single non-MENA
  // country (e.g. "Remote - US only") — this tier means "show me the
  // widest net of remote jobs," not "guarantee I'm personally eligible for
  // every one." A genuinely unknown scope still fails closed; this
  // function never claims certainty it doesn't have.
  return job.remoteScope === null ? ineligible("remote_scope_unknown", arrangementStatus) : eligible(arrangementStatus);
}
