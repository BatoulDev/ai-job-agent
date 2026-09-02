// Pure, framework-free mapping from get_onboarding_readiness()'s next_step
// to a POST-AUTH destination path — the one place this mapping is written.
// Kept in its own zero-dependency module (no next/headers, no Supabase
// client) so it can be imported both from Node-only server code
// (src/lib/entitlements/postAuthDestination.ts) and from the edge/proxy
// request context (src/lib/supabase/session.ts), and so it's directly
// unit-testable without mocking anything.
//
// Every caller of this function is a RETURNING-AUTH entry point (email/
// password login, the Google OAuth callback, and the proxy's
// already-authenticated-visitor-on-/login-or-/signup redirect) — never the
// "just finished uploading a CV in this onboarding flow" continuation,
// which is a separate, hardcoded `router.push("/onboarding/preferences")`
// in src/app/onboarding/upload-cv/page.tsx that never calls this function.
// That's why next_step "preferences" maps to /dashboard here: a user who
// already has an active CV but incomplete preferences and is now returning
// (not mid-upload) must land on the Dashboard, which surfaces its own
// "complete your preferences" modal/banner (see
// src/components/dashboard/PreferencesReminderModal.tsx) rather than being
// forced straight back into the onboarding form.
export function onboardingStepToPath(nextStep: string): string {
  switch (nextStep) {
    case "upload_cv":
      return "/onboarding/upload-cv";
    case "dashboard":
    case "preferences":
      return "/dashboard";
    // "plan", "profile_missing", "login", and any unrecognized value all
    // fall back to /dashboard — /dashboard's own loading/error states
    // already handle a missing profile or plan safely (see
    // dashboard/page.tsx's loadError branch), so this is never a dead end.
    default:
      return "/dashboard";
  }
}
