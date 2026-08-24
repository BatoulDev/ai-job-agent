import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashUserIdentifier } from "@/lib/authRateLimit/identifiers";
import { AUTH_RATE_LIMIT_POLICIES, clearAuthAttempts, reserveAuthAttempt } from "@/lib/authRateLimit/rateLimit";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "@/lib/authValidation/password";

const GENERIC_RATE_LIMIT_ERROR = "Too many attempts. Please wait a bit and try again.";

function parsePassword(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length < MIN_PASSWORD_LENGTH || raw.length > MAX_PASSWORD_LENGTH) return null;
  return raw;
}

// POST /api/auth/update-password
// Password update after a recovery-link sign-in. Requires an already
// authenticated session (established by exchangeCodeForSession in
// src/app/auth/callback/route.ts) — this route never accepts a recovery
// token or code itself, only the new password, and derives the user
// strictly from the session cookie, never from the request body.
//
// Rate-limited by user id (see src/lib/authRateLimit/rateLimit.ts for why
// this surface uses 'user' rather than email/session), generous enough
// that a page refresh — which never calls this route on its own — can
// never lock a legitimate user out.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const password =
    typeof body === "object" && body !== null
      ? parsePassword((body as Record<string, unknown>).password)
      : null;

  if (password === null) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const userHash = hashUserIdentifier(user.id);
  const gate = await reserveAuthAttempt(
    "password_update",
    "user",
    userHash,
    AUTH_RATE_LIMIT_POLICIES.password_update_user
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

  const { error: updateError } = await supabase.auth.updateUser({ password });

  if (updateError) {
    // Never surface updateError.message (raw Supabase Auth text) except
    // for this one known, safe, stable substring.
    const message = updateError.message.includes("same password")
      ? "Your new password must be different from your current one."
      : "Failed to update your password. Please try again.";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  await clearAuthAttempts("password_update", "user", userHash);

  return NextResponse.json({ ok: true });
}
