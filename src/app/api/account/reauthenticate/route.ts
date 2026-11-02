import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashUserIdentifier } from "@/lib/authRateLimit/identifiers";
import { AUTH_RATE_LIMIT_POLICIES, clearAuthAttempts, reserveAuthAttempt } from "@/lib/authRateLimit/rateLimit";
import { MAX_PASSWORD_LENGTH } from "@/lib/authValidation/password";

const GENERIC_ERROR = "Incorrect password.";
const GENERIC_RATE_LIMIT_ERROR = "Too many attempts. Please wait and try again.";

// POST /api/account/reauthenticate
//
// Password re-entry gate for the account-deletion flow (founder-approved
// 2026-11-02 — see docs/ACCOUNT_DELETION_DESIGN.md). Password-provider
// accounts only; Google-provider accounts re-authenticate via a fresh
// signInWithOAuth round-trip instead (src/lib/authRateLimit/
// startGoogleOAuth.ts), which this route does not handle.
//
// The email always comes from the caller's own already-authenticated
// session (supabase.auth.getUser()), never from the request body — so this
// can never be used to test an arbitrary account's password (AGENTS.md
// §28). A successful signInWithPassword call re-issues the session cookie
// with a fresh `iat`, which is what src/lib/account/sessionFreshness.ts's
// freshness check on POST /api/account/delete relies on.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user || !user.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (user.app_metadata?.provider !== "email") {
    return NextResponse.json(
      { error: "This account signs in with Google. Re-authenticate with Google instead." },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const password = typeof body === "object" && body !== null ? (body as Record<string, unknown>).password : null;
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  const identifierHash = hashUserIdentifier(user.id);
  const gate = await reserveAuthAttempt(
    "account_reauth",
    "user",
    identifierHash,
    AUTH_RATE_LIMIT_POLICIES.account_reauth_user
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

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password,
  });

  if (signInError) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  await clearAuthAttempts("account_reauth", "user", identifierHash);
  return NextResponse.json({ ok: true });
}
