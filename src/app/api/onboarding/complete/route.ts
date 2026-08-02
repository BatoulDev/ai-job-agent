import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOnboardingReadiness } from "@/lib/entitlements/readiness";

// Called once the user finishes the preferences step. Does NOT run AI
// analysis, job matching, or any n8n workflow (Phase 4/5/6, not built
// yet) — it only enqueues an analysis_tasks row for a future worker to
// pick up, and only when the trusted readiness check confirms the user
// actually has a CV, a matching Storage object, complete preferences, and
// an eligible plan. Safe to call repeatedly: create_analysis_task reuses
// any already-active task for the same CV instead of creating a
// duplicate (enforced by a partial unique index in the database, not just
// this check), so a page refresh or resubmission can never double-enqueue.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let readiness;
  try {
    readiness = await getOnboardingReadiness();
  } catch (error) {
    console.error("Onboarding readiness check failed:", error);
    return NextResponse.json(
      { error: "Could not check onboarding status." },
      { status: 500 }
    );
  }

  const canEnqueue =
    readiness.hasCv &&
    readiness.cvStorageObjectExists &&
    readiness.preferencesComplete &&
    readiness.planEligible &&
    !readiness.hasActiveAnalysisTask &&
    readiness.cvId;

  if (canEnqueue && readiness.cvId) {
    const admin = createAdminClient();
    const { error: taskError } = await admin.rpc("create_analysis_task", {
      p_user_id: user.id,
      p_cv_id: readiness.cvId,
      p_trigger: "onboarding_completed",
    });

    if (taskError) {
      // Non-fatal: the user's onboarding data is already saved correctly.
      // A future reconciliation pass (Phase 4) can enqueue any CV that
      // completed onboarding but has no task, so we still return success
      // for navigation purposes rather than blocking the user here.
      console.error("Failed to enqueue analysis task:", taskError);
    }
  }

  return NextResponse.json({
    nextStep: readiness.nextStep,
    onboardingComplete: readiness.onboardingComplete,
  });
}
