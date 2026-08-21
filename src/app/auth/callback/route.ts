import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOnboardingReadiness } from "@/lib/entitlements/readiness";
import { isSafeRedirectPath } from "@/lib/safeRedirect";

function onboardingStepToPath(nextStep: string): string {
  switch (nextStep) {
    case "upload_cv":
      return "/onboarding/upload-cv";
    case "preferences":
      return "/onboarding/preferences";
    case "dashboard":
      return "/dashboard";
    default:
      return "/dashboard";
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const error = searchParams.get("error");

  // OAuth provider or Supabase returned an error (e.g. user cancelled Google).
  if (error) {
    return NextResponse.redirect(
      new URL("/login?error=google_auth_failed", origin)
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    // Recovery links that are expired, already used, or malformed land here.
    return NextResponse.redirect(
      new URL("/login?error=link_expired", origin)
    );
  }

  // A safe explicit next destination (e.g. next=/reset-password from the
  // password-reset email link) takes priority over the readiness-derived path.
  if (isSafeRedirectPath(next)) {
    return NextResponse.redirect(new URL(next, origin));
  }

  // For Google OAuth sign-ins, derive the correct landing page from the
  // user's onboarding state so new users reach onboarding and returning
  // users reach the dashboard.
  try {
    const readiness = await getOnboardingReadiness();
    if (!readiness.authenticated) {
      return NextResponse.redirect(new URL("/login", origin));
    }
    if (readiness.nextStep === "profile_missing") {
      return NextResponse.redirect(
        new URL("/login?error=auth_error", origin)
      );
    }
    return NextResponse.redirect(
      new URL(onboardingStepToPath(readiness.nextStep), origin)
    );
  } catch {
    return NextResponse.redirect(new URL("/dashboard", origin));
  }
}
