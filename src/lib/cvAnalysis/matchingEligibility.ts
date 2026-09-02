import type { CvAnalysis } from "./types";

// Frontend mirror of the canonical backend matching-eligibility gate
// (is_cv_analysis_matching_eligible() / confirm_cv_analysis() — see
// supabase/migrations/20260825100000_harden_confirm_cv_analysis_freshness.sql
// and 20260825100010_add_matching_eligibility_gate.sql). All four
// conditions must hold together. Extracted as its own pure function (rather
// than inlined in dashboard/page.tsx) so it has one, directly-testable
// definition — checking only review_status/is_current here previously let a
// profile that had gone stale after a preference change keep showing as
// unlocked, reproduced live during the Automation-1 audit. The database
// remains the authoritative enforcement point; this only controls what the
// dashboard shows before that.
export function isProfileMatchingEligible(
  analysis: Pick<
    CvAnalysis,
    "review_status" | "is_current" | "recommendations_state" | "preferences_version"
  > | null,
  latestPreferencesVersion: number | null
): boolean {
  if (!analysis) return false;

  return (
    analysis.review_status === "approved" &&
    analysis.is_current === true &&
    analysis.recommendations_state === "current" &&
    analysis.preferences_version != null &&
    latestPreferencesVersion != null &&
    analysis.preferences_version === latestPreferencesVersion
  );
}
