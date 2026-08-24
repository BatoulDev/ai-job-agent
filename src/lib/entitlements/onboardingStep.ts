// Pure, framework-free mapping from get_onboarding_readiness()'s next_step
// to the destination path — the one place this mapping is written. Kept in
// its own zero-dependency module (no next/headers, no Supabase client) so
// it can be imported both from Node-only server code
// (src/lib/entitlements/postAuthDestination.ts) and from the edge/proxy
// request context (src/lib/supabase/session.ts), and so it's directly
// unit-testable without mocking anything.
export function onboardingStepToPath(nextStep: string): string {
  switch (nextStep) {
    case "upload_cv":
      return "/onboarding/upload-cv";
    case "preferences":
      return "/onboarding/preferences";
    case "dashboard":
      return "/dashboard";
    // "plan", "profile_missing", "login", and any unrecognized value all
    // fall back to /dashboard — /dashboard's own loading/error states
    // already handle a missing profile or plan safely (see
    // dashboard/page.tsx's loadError branch), so this is never a dead end.
    default:
      return "/dashboard";
  }
}
