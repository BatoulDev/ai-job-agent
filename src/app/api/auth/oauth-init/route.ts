import { NextResponse } from "next/server";
import { getOrCreateSessionIdentifier } from "@/lib/authRateLimit/identifiers";
import { AUTH_RATE_LIMIT_POLICIES, reserveAuthAttempt } from "@/lib/authRateLimit/rateLimit";

const GENERIC_RATE_LIMIT_ERROR = "Too many attempts. Please wait and try again.";

// POST /api/auth/oauth-init
// Defense-in-depth gate checked immediately before login/page.tsx and
// signup/page.tsx call supabase.auth.signInWithOAuth() — that call has no
// email/password to key a limit on and, being a plain browser redirect to
// Google, has no other natural server round-trip to attach one to either.
// Keyed purely by the same opaque, HttpOnly per-browser session cookie
// used as the secondary key for signup/forgot-password
// (src/lib/authRateLimit/identifiers.ts) — never IP, never anything tied
// to a Google account (there isn't one yet at this point in the flow).
//
// IMPORTANT LIMITATION (documented, not a bug): this only protects this
// app's own OAuth-initiation button. The Supabase Auth REST API is
// directly reachable by anyone holding the public anon key — exactly the
// same inherent limitation already documented for login
// (supabase/migrations/20260822110000_add_login_rate_limiting.sql) — so
// this is defense-in-depth against casual/scripted abuse of the app's own
// UI, not a guarantee against someone bypassing the app entirely.
export async function POST() {
  const sessionHash = await getOrCreateSessionIdentifier();

  const gate = await reserveAuthAttempt(
    "oauth_init",
    "session",
    sessionHash,
    AUTH_RATE_LIMIT_POLICIES.oauth_init_session
  );

  if (gate === null) {
    return NextResponse.json(
      { error: "We couldn't process your request right now. Please try again shortly." },
      { status: 500 }
    );
  }

  if (!gate.allowed) {
    return NextResponse.json(
      { error: GENERIC_RATE_LIMIT_ERROR, retryAfterSeconds: gate.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  return NextResponse.json({ ok: true });
}
