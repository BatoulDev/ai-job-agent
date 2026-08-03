import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "./env";
import { isSafeRedirectPath } from "@/lib/safeRedirect";

// Route groups gated by src/proxy.ts. Prefix match: "/onboarding" also
// covers "/onboarding/preferences" and "/onboarding/upload-cv".
const PROTECTED_PATHS = ["/welcome", "/onboarding", "/dashboard", "/news", "/checkout"];
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
    return withCookiesFrom(response, NextResponse.redirect(redirectUrl));
  }

  if (user && isAuthOnly) {
    const next = request.nextUrl.searchParams.get("next");
    const redirectUrl = new URL(isSafeRedirectPath(next) ? next : "/dashboard", request.url);
    return withCookiesFrom(response, NextResponse.redirect(redirectUrl));
  }

  return response;
}
