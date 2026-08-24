import { createAdminClient } from "@/lib/supabase/admin";

export type AuthRateLimitAction =
  | "login"
  | "signup"
  | "forgot_password"
  | "oauth_init"
  | "oauth_callback"
  | "password_update";
export type AuthRateLimitIdentifierKind = "email" | "session" | "user";

export interface AuthRateLimitPolicy {
  limit: number;
  windowMinutes: number;
}

// Single source of truth for every surface's limit/window — change the
// numbers here only, nowhere else. Each surface is deliberately generous
// enough that a legitimate user retrying a typo'd password, an unconfirmed
// signup, or a missed reset email is never blocked in normal use.
export const AUTH_RATE_LIMIT_POLICIES = {
  login: { limit: 5, windowMinutes: 15 },
  signup_email: { limit: 5, windowMinutes: 15 },
  // Session-keyed policies exist specifically so "submit a different email"
  // can't reset the limit — see the migration's design note.
  signup_session: { limit: 8, windowMinutes: 15 },
  forgot_password_email: { limit: 3, windowMinutes: 15 },
  forgot_password_session: { limit: 5, windowMinutes: 15 },
  oauth_init_session: { limit: 10, windowMinutes: 15 },
  // Session-keyed (same arl_sid cookie): bounds a script hammering the
  // callback with garbage `code` values from one browser; a real user only
  // ever hits this once per login or reset-link click, so this must never
  // be tight enough to affect normal use.
  oauth_callback_session: { limit: 20, windowMinutes: 15 },
  // User-keyed: by the time this route is called the caller already has a
  // valid, authenticated recovery session, so their own id — not email or
  // the anonymous session cookie — is the correct identifier. Generous
  // enough that a page refresh (which never calls this on its own) can
  // never lock a legitimate user out of setting their password.
  password_update_user: { limit: 8, windowMinutes: 15 },
} as const satisfies Record<string, AuthRateLimitPolicy>;

export interface RateLimitReservation {
  allowed: boolean;
  retryAfterSeconds: number;
}

// Calls reserve_auth_attempt() via the service-role admin client — this
// RPC is granted to service_role only (see the migration), so it is only
// ever reachable from server-only code like this module, never from the
// browser. Returns null (logged server-side) on an unexpected RPC error.
//
// Policy: FAIL CLOSED. Every call site in src/app/api/auth/*/route.ts
// treats a null result as "cannot verify the request" and returns a safe
// generic 500 without ever calling the protected Supabase Auth operation —
// consistent with AGENTS.md §18/§27 ("never silently report an action as
// successful when its result is unknown") for these specific operations
// (login, signup, password reset, OAuth initiation), where letting a
// request through unverified would defeat the entire point of this module.
// The trade-off is accepted deliberately: a transient reserve_auth_attempt
// failure blocks these four pre-auth surfaces until the RPC recovers,
// rather than risk letting a rate-limit bypass through. This is a single
// point of failure worth monitoring in production (see
// docs/PRODUCTION_READINESS.md), not something to silently work around here.
export async function reserveAuthAttempt(
  action: AuthRateLimitAction,
  identifierKind: AuthRateLimitIdentifierKind,
  identifierHash: string,
  policy: AuthRateLimitPolicy
): Promise<RateLimitReservation | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reserve_auth_attempt", {
    p_action: action,
    p_identifier_kind: identifierKind,
    p_identifier_hash: identifierHash,
    p_limit: policy.limit,
    p_window_minutes: policy.windowMinutes,
  });

  if (error) {
    console.error(
      `reserve_auth_attempt RPC error (${action}/${identifierKind}):`,
      error.code,
      error.message
    );
    return null;
  }

  const row = data?.[0];
  if (!row) return null;
  return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
}

// Resets the rolling-window count for one (action, identifierKind) pair
// after a genuinely successful attempt. Non-fatal by design if it errors —
// see each route handler's own comment on why a stale count is never a
// correctness problem, only a slightly stricter next window.
export async function clearAuthAttempts(
  action: AuthRateLimitAction,
  identifierKind: AuthRateLimitIdentifierKind,
  identifierHash: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("clear_auth_attempts", {
    p_action: action,
    p_identifier_kind: identifierKind,
    p_identifier_hash: identifierHash,
  });

  if (error) {
    console.error(
      `clear_auth_attempts RPC error (${action}/${identifierKind}):`,
      error.code,
      error.message
    );
  }
}
