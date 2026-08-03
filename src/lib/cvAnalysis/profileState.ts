import type { CvAnalysis } from "./types";
import type { AnalysisTask } from "@/lib/analysisTasks/types";

// The 8 CV Profile page states (Phase 4 UI spec). Derived purely from
// real data — never set directly by a component. No state here implies
// or fabricates a database write; it only describes what's currently true.
export type CvProfileState =
  | "no_cv"
  | "no_preferences"
  | "analyzing"
  | "ready_for_review"
  | "changes_requested"
  | "approved"
  | "preferences_outdated"
  | "failed";

export interface DeriveCvProfileStateInput {
  hasActiveCv: boolean;
  preferencesComplete: boolean;
  task: Pick<AnalysisTask, "status"> | null;
  analysis: Pick<CvAnalysis, "status" | "review_status" | "recommendations_state"> | null;
}

// Priority order (most specific/urgent first). A row can technically
// satisfy more than one condition at once (e.g. review_status="approved"
// AND recommendations_state="stale" — an approval that's since gone
// out of date) — the order below decides which single state wins, and
// is deliberately chosen so the more actionable state always surfaces.
export function deriveCvProfileState({
  hasActiveCv,
  preferencesComplete,
  task,
  analysis,
}: DeriveCvProfileStateInput): CvProfileState {
  if (!hasActiveCv) return "no_cv";
  if (!preferencesComplete) return "no_preferences";

  if (analysis) {
    if (analysis.status === "failed") return "failed";
    if (analysis.status === "processing") return "analyzing";
    if (analysis.review_status === "changes_requested") return "changes_requested";
    if (analysis.recommendations_state === "stale") return "preferences_outdated";
    if (analysis.review_status === "approved") return "approved";
    // status === "completed" && review_status === "pending_review" &&
    // recommendations_state === "current"
    return "ready_for_review";
  }

  if (task) {
    if (task.status === "failed") return "failed";
    if (task.status === "pending" || task.status === "processing") return "analyzing";
  }

  // CV and preferences are both ready but nothing has been queued or
  // analyzed yet (e.g. the automatic task-creation call after saving
  // preferences didn't run). Honest framing: analysis is expected
  // imminently, not fabricated progress.
  return "analyzing";
}

// Mirrors get_onboarding_readiness()'s v_preferences_complete computation
// exactly (supabase/migrations/20260806090110_update_onboarding_readiness_reference_preferences.sql)
// — kept in sync deliberately, not reinvented. A preferred location is
// only required when workArrangement is onsite/hybrid.
export function isPreferencesComplete(input: {
  countryOfResidence: string | null;
  hasUniversity: boolean;
  hasMajor: boolean;
  hasTargetRole: boolean;
  workArrangement: string | null;
  jobType: string | null;
  experienceLevel: string | null;
  hasLocation: boolean;
} | null): boolean {
  if (!input) return false;

  return !!(
    input.countryOfResidence &&
    input.hasUniversity &&
    input.hasMajor &&
    input.hasTargetRole &&
    input.workArrangement &&
    input.jobType &&
    input.experienceLevel &&
    (!(input.workArrangement === "onsite" || input.workArrangement === "hybrid") || input.hasLocation)
  );
}

// Phase 6 — Request Changes. Typed payload a future backend endpoint can
// receive; nothing in this phase submits it anywhere real (no such
// endpoint exists yet — see the CV Profile page's report).
export type RequestChangesReason =
  | "incorrect_cv_information"
  | "update_preferences"
  | "change_ai_recommendations"
  | "cv_changed"
  | "other";

export interface RequestChangesPayload {
  analysisId: string;
  reason: RequestChangesReason;
  affectedSection?: string;
  feedback?: string;
}
