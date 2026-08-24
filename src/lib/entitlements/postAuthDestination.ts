import { getOnboardingReadiness } from "@/lib/entitlements/readiness";
import { onboardingStepToPath } from "@/lib/entitlements/onboardingStep";

export { onboardingStepToPath };

export type PostAuthDestination =
  | { kind: "redirect"; path: string }
  | { kind: "unauthenticated" }
  // A signed-in session with no public.profiles row is a genuinely broken
  // state (the handle_new_user trigger should always create one — see
  // supabase/migrations/20260714153102_handle_new_user_trigger.sql), never
  // an expected onboarding step. Surfaced as its own kind, not silently
  // folded into a redirect, so each call site can decide how to react
  // (the OAuth callback bounces to /login with a safe error; login itself
  // falls back to /dashboard, which already reports this via its own
  // loadError state without a redirect loop back to /login).
  | { kind: "profile_missing" };

// Server-only (getOnboardingReadiness reads the caller's own verified
// session via next/headers cookies()) — call this only from a Route
// Handler or Server Component context, never from the browser. Never
// trusts a client-supplied flag: the entire decision is derived from
// get_onboarding_readiness(), which itself evaluates auth.uid() from the
// caller's own session server-side.
export async function resolvePostAuthDestination(): Promise<PostAuthDestination> {
  const readiness = await getOnboardingReadiness();
  if (!readiness.authenticated) {
    return { kind: "unauthenticated" };
  }
  if (readiness.nextStep === "profile_missing") {
    return { kind: "profile_missing" };
  }
  return { kind: "redirect", path: onboardingStepToPath(readiness.nextStep) };
}
