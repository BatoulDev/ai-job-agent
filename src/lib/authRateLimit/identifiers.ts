import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";

const SESSION_COOKIE_NAME = "arl_sid";
// Comfortably covers the longest window any surface uses (see
// src/lib/authRateLimit/rateLimit.ts) with margin — the cookie only needs
// to outlive the rolling window it's being checked against.
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60;

// Never store or transmit the raw email — only this keyed hash ever
// reaches the database. Kept in sync with the ^[0-9a-f]{64}$ validation in
// reserve_auth_attempt()/clear_auth_attempts()
// (supabase/migrations/20260822130000_generalize_auth_rate_limits.sql).
export function hashEmailIdentifier(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

// For surfaces reached only with an already-authenticated session (e.g.
// password update after recovery) — the user's own id is a more precise,
// already-verified identifier than email or the anonymous session cookie,
// so surfaces that know it should use it instead of falling back to those.
export function hashUserIdentifier(userId: string): string {
  return createHash("sha256").update(userId).digest("hex");
}

// A privacy-safe, per-browser identifier for auth surfaces that either have
// no email at all (OAuth initiation) or need a secondary key that can't be
// bypassed by simply submitting a different email (signup, forgot-password
// — see the migration's design note). The cookie itself holds only a
// random opaque UUID, HttpOnly so client JS can never read or forge it;
// only its sha256 hash ever reaches the database, and the raw value never
// does. Deliberately never derived from IP or any client-settable header —
// there is no verified trusted-proxy source in this app, and trusting one
// would either be trivially spoofable or would incorrectly rate-limit an
// entire shared network behind one address.
export async function getOrCreateSessionIdentifier(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const isValid = existing !== undefined && /^[0-9a-f-]{36}$/.test(existing);
  const value = isValid ? existing! : randomUUID();

  if (!isValid) {
    cookieStore.set(SESSION_COOKIE_NAME, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    });
  }

  return createHash("sha256").update(value).digest("hex");
}
