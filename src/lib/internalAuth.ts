import { timingSafeEqual } from "node:crypto";

// Shared Bearer-secret check for internal, service-to-service-only routes
// (never called from a browser — no user session, no RLS-scoped client).
// Fails closed if the expected secret isn't configured (AGENTS.md §21 —
// no insecure fallback). Used by every route under src/app/api/internal/*.
export function isAuthorizedInternalRequest(request: Request, envVarName: string): boolean {
  const secret = process.env[envVarName];
  if (!secret) return false;

  const header = request.headers.get("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!provided) return false;

  const expected = Buffer.from(secret);
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
