import { createClient } from "@/lib/supabase/server";

export type OnboardingNextStep =
  | "login"
  | "profile_missing"
  | "plan"
  | "upload_cv"
  | "preferences"
  | "dashboard";

export interface OnboardingReadiness {
  authenticated: boolean;
  hasProfile: boolean;
  hasCv: boolean;
  cvStorageObjectExists: boolean;
  cvId: string | null;
  hasPreferences: boolean;
  preferencesComplete: boolean;
  planCode: string | null;
  subscriptionStatus: string | null;
  planEligible: boolean;
  hasActiveAnalysisTask: boolean;
  onboardingComplete: boolean;
  nextStep: OnboardingNextStep;
}

interface ReadinessRow {
  authenticated: boolean;
  has_profile?: boolean;
  has_cv?: boolean;
  cv_storage_object_exists?: boolean;
  cv_id?: string | null;
  has_preferences?: boolean;
  preferences_complete?: boolean;
  plan_code?: string | null;
  subscription_status?: string | null;
  plan_eligible?: boolean;
  has_active_analysis_task?: boolean;
  onboarding_complete?: boolean;
  next_step: string;
}

// Trusted server-side readiness check. Wraps the public.get_onboarding_readiness()
// database function (security invoker — evaluates auth.uid() from the caller's
// own verified session, never a client-supplied user id). This is what
// deciding "where should this user land next" must call — never a
// frontend-only flag.
export async function getOnboardingReadiness(): Promise<OnboardingReadiness> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_onboarding_readiness");

  if (error) {
    throw new Error(`Failed to load onboarding readiness: ${error.message}`);
  }

  if (!data || typeof data !== "object" || typeof (data as ReadinessRow).next_step !== "string") {
    throw new Error("Malformed response from get_onboarding_readiness");
  }

  const row = data as ReadinessRow;

  return {
    authenticated: row.authenticated,
    hasProfile: row.has_profile ?? false,
    hasCv: row.has_cv ?? false,
    cvStorageObjectExists: row.cv_storage_object_exists ?? false,
    cvId: row.cv_id ?? null,
    hasPreferences: row.has_preferences ?? false,
    preferencesComplete: row.preferences_complete ?? false,
    planCode: row.plan_code ?? null,
    subscriptionStatus: row.subscription_status ?? null,
    planEligible: row.plan_eligible ?? false,
    hasActiveAnalysisTask: row.has_active_analysis_task ?? false,
    onboardingComplete: row.onboarding_complete ?? false,
    nextStep: (row.next_step as OnboardingNextStep) ?? "login",
  };
}
