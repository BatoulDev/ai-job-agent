import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolvePostAuthDestination } from "@/lib/entitlements/postAuthDestination";
import { isSafeRedirectPath } from "@/lib/safeRedirect";
import { getOrCreateSessionIdentifier } from "@/lib/authRateLimit/identifiers";
import { AUTH_RATE_LIMIT_POLICIES, reserveAuthAttempt } from "@/lib/authRateLimit/rateLimit";

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

  // Defense-in-depth against a script hammering this endpoint with garbage
  // `code` values from one browser session (see
  // src/lib/authRateLimit/rateLimit.ts for the generous threshold chosen
  // specifically so a real one-click provider redirect, or a real
  // reset-link click, is never affected). Fails closed, consistent with
  // every other auth surface: if the limiter itself cannot be verified,
  // this request is not allowed to proceed.
  const sessionHash = await getOrCreateSessionIdentifier();
  const callbackGate = await reserveAuthAttempt(
    "oauth_callback",
    "session",
    sessionHash,
    AUTH_RATE_LIMIT_POLICIES.oauth_callback_session
  );
  if (callbackGate === null || !callbackGate.allowed) {
    return NextResponse.redirect(new URL("/login?error=too_many_attempts", origin));
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
  // user's onboarding state — via the same authoritative resolver used by
  // email/password login (src/app/api/auth/login/route.ts) — so new users
  // reach onboarding and returning users reach the dashboard, never the
  // reverse. Never derived from a client-supplied flag: the resolver's
  // entire decision comes from get_onboarding_readiness(), evaluated
  // server-side against this request's own just-established session.
  try {
    const destination = await resolvePostAuthDestination();
    if (destination.kind === "unauthenticated") {
      return NextResponse.redirect(new URL("/login", origin));
    }
    if (destination.kind === "profile_missing") {
      return NextResponse.redirect(
        new URL("/login?error=auth_error", origin)
      );
    }
    return NextResponse.redirect(new URL(destination.path, origin));
  } catch {
    return NextResponse.redirect(new URL("/dashboard", origin));
  }
}
