// Default-off, env-var-gated allow-list intersection. Added 2026-11-02 to
// bound a one-time local real-AI validation run to explicitly synthetic
// rows, after confirming the local database holds real ingested jobs and a
// real user's real cv_analyses row that would otherwise be eligible for a
// real embeddings/rerank call.
//
// Deliberately NOT a new query or a new gate of its own — every call site
// below ADDS `.in("id", allowlist)` onto the exact same query that already
// runs today. When the relevant env var is unset or empty (true in every
// environment except this one explicitly-configured local test run,
// including production), the intersection is skipped entirely and every
// query here is byte-identical to before this file existed. When set, it
// can only ever narrow the existing result set — it is structurally
// incapable of granting access to a row the original query would not
// already have returned, so it cannot weaken any existing eligibility,
// plan, or security check.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses a comma-separated UUID allow-list from an env var. Returns null
 * (meaning "no restriction, behave as before") when unset/empty. Throws on
 * a non-empty value containing anything that isn't a well-formed UUID —
 * fails loudly on a malformed test configuration rather than silently
 * running with a partial or wrong allow-list.
 */
export function parseIdAllowlist(envValue: string | undefined, envVarName: string): string[] | null {
  if (!envValue || envValue.trim().length === 0) return null;
  const ids = envValue.split(",").map((id) => id.trim()).filter((id) => id.length > 0);
  if (ids.length === 0) return null;
  for (const id of ids) {
    if (!UUID_RE.test(id)) {
      throw new Error(`${envVarName}: "${id}" is not a well-formed UUID`);
    }
  }
  return ids;
}
