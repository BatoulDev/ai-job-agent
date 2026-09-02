// Unit tests for src/lib/entitlements/onboardingStep.ts — the single,
// shared POST-AUTH mapping from get_onboarding_readiness()'s next_step to a
// destination path, used identically by the OAuth callback
// (src/app/auth/callback/route.ts), email/password login
// (src/app/api/auth/login/route.ts), and the proxy's already-authenticated
// /login and /signup redirect (src/lib/supabase/session.ts). Imported
// directly — zero framework dependencies.
//
// This mapping intentionally differs from the ONBOARDING-CONTINUATION path
// (a successful CV upload always goes straight to /onboarding/preferences,
// hardcoded in src/app/onboarding/upload-cv/page.tsx, which never calls
// this function) — see that distinction documented in onboardingStep.ts.
//
// Run: node --experimental-strip-types --test tests/unit/onboarding-step-to-path.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { onboardingStepToPath } from "../../src/lib/entitlements/onboardingStep.ts";

describe("onboardingStepToPath", () => {
  test("upload_cv -> /onboarding/upload-cv", () => {
    assert.equal(onboardingStepToPath("upload_cv"), "/onboarding/upload-cv");
  });

  test("preferences -> /dashboard (returning-auth entry points never force a CV+incomplete-preferences user back into onboarding; Dashboard shows its own reminder)", () => {
    assert.equal(onboardingStepToPath("preferences"), "/dashboard");
  });

  test("dashboard -> /dashboard", () => {
    assert.equal(onboardingStepToPath("dashboard"), "/dashboard");
  });

  test("plan (not yet eligible) falls back to /dashboard, never a dead end", () => {
    assert.equal(onboardingStepToPath("plan"), "/dashboard");
  });

  test("profile_missing falls back to /dashboard (its own loadError state handles this)", () => {
    assert.equal(onboardingStepToPath("profile_missing"), "/dashboard");
  });

  test("login falls back to /dashboard", () => {
    assert.equal(onboardingStepToPath("login"), "/dashboard");
  });

  test("an unrecognized/future value falls back to /dashboard, never throws", () => {
    assert.equal(onboardingStepToPath("some_future_step"), "/dashboard");
    assert.equal(onboardingStepToPath(""), "/dashboard");
  });

  test("every possible mapped destination is one of exactly two known post-auth routes (never /onboarding/preferences)", () => {
    const KNOWN_DESTINATIONS = new Set(["/onboarding/upload-cv", "/dashboard"]);
    const inputs = ["upload_cv", "preferences", "dashboard", "plan", "profile_missing", "login", "garbage"];
    for (const input of inputs) {
      assert.ok(KNOWN_DESTINATIONS.has(onboardingStepToPath(input)), `unexpected destination for "${input}"`);
    }
  });
});
