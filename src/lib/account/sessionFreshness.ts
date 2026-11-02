// Proves "recent authentication" (AGENTS.md §28; founder-approved
// reauthentication requirement for account deletion, 2026-11-02) by reading
// the `iat` (issued-at) claim already present on the session's own access
// token, instead of inventing a separate reauth-token table/column. A fresh
// password re-entry (POST /api/account/reauthenticate) or a fresh Google
// OAuth round-trip both re-issue the session via signInWithPassword /
// exchangeCodeForSession, which stamps a new `iat` — so "is this session
// fresh" and "did the user just re-authenticate" are the same question.
//
// No signature verification here: every caller decodes the access token
// returned by supabase.auth.getSession() only AFTER supabase.auth.getUser()
// has already revalidated that exact token against Supabase Auth in the
// same request (see src/lib/supabase/session.ts's own comment on why
// getUser(), not getSession(), is the trust boundary) — this only reads a
// claim off a token already proven valid moments earlier.
export const REAUTH_FRESHNESS_SECONDS = 5 * 60;

export function decodeJwtIssuedAt(accessToken: string): number | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const iat = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).iat : null;
    return typeof iat === "number" ? iat : null;
  } catch {
    return null;
  }
}

export function isSessionFresh(issuedAtSeconds: number, nowSeconds: number = Date.now() / 1000): boolean {
  return nowSeconds - issuedAtSeconds <= REAUTH_FRESHNESS_SECONDS;
}
