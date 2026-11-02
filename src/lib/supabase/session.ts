import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "./env";
import { isSafeRedirectPath } from "@/lib/safeRedirect";
import { onboardingStepToPath } from "@/lib/entitlements/onboardingStep";
import { buildSecurityHeaders } from "@/lib/security/securityHeaders";

const supabaseOrigin = new URL(supabaseUrl).origin;

// Applied to every response this function returns (redirect or continue) —
// one place, so no route can accidentally ship without these headers.
function withSecurityHeaders(response: NextResponse, request: NextRequest): NextResponse {
  const isDev = process.env.NODE_ENV !== "production";
  const isHttps =
    request.headers.get("x-forwarded-proto") === "https" || request.nextUrl.protocol === "https:";
  for (const { key, value } of buildSecurityHeaders({ isDev, isHttps, supabaseOrigin })) {
    response.headers.set(key, value);
  }
  return response;
}

// Route groups gated by src/proxy.ts. Prefix match: "/onboarding" also
// covers "/onboarding/preferences" and "/onboarding/upload-cv".
const PROTECTED_PATHS = ["/welcome", "/onboarding", "/dashboard", "/checkout", "/settings"];
const AUTH_ONLY_PATHS = ["/login", "/signup"];

function isUnderPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

// Copies refreshed auth cookies from the "next" response onto a redirect
// response, so a session refresh that happened during this same request
// isn't dropped just because we're also redirecting.
function withCookiesFrom(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}

// Shared by src/proxy.ts. Refreshes the auth session on every matched
// request and writes the updated cookies onto the response — without this,
// sessions expire unpredictably instead of refreshing silently. Also
// redirects unauthenticated visitors away from protected routes and
// authenticated visitors away from /login and /signup.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // getUser() revalidates the token against Supabase Auth; do not replace
  // this with getSession(), which only reads the (possibly stale) cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PATHS.some((path) => isUnderPath(pathname, path));
  const isAuthOnly = AUTH_ONLY_PATHS.some((path) => isUnderPath(pathname, path));

  if (!user && isProtected) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return withSecurityHeaders(withCookiesFrom(response, NextResponse.redirect(redirectUrl)), request);
  }

  if (user && isAuthOnly) {
    const next = request.nextUrl.searchParams.get("next");
    if (isSafeRedirectPath(next)) {
      return withSecurityHeaders(withCookiesFrom(response, NextResponse.redirect(new URL(next, request.url))), request);
    }
    // Same authoritative resolver every other post-auth entry point uses
    // (src/lib/entitlements/postAuthDestination.ts, shared with
    // src/app/api/auth/login/route.ts and src/app/auth/callback/route.ts)
    // — an already-authenticated visitor landing back on /login or /signup
    // (e.g. the browser back button right after signing in) must be routed
    // by the same onboarding-state rules as a fresh sign-in, never
    // unconditionally to /dashboard. Calls the RPC directly rather than
    // importing getOnboardingReadiness()/resolvePostAuthDestination(): both
    // use next/headers' cookies(), which isn't available in this
    // proxy/edge request-scoped context — this function already has its
    // own request-bound Supabase client above, so only the pure
    // onboardingStepToPath mapping is reused here.
    const { data: readiness } = await supabase.rpc("get_onboarding_readiness");
    const nextStep =
      readiness && typeof readiness === "object" && typeof (readiness as { next_step?: unknown }).next_step === "string"
        ? (readiness as { next_step: string }).next_step
        : "dashboard";
    const redirectUrl = new URL(onboardingStepToPath(nextStep), request.url);
    return withSecurityHeaders(withCookiesFrom(response, NextResponse.redirect(redirectUrl)), request);
  }

  return withSecurityHeaders(response, request);
}
