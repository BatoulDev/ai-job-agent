// scripts/db-test-fixture-marker.mjs
//
// Pure, side-effect-free fixture-email marker logic shared by
// scripts/db-test-crash-recovery-sweep.mjs (the destructive crash-recovery
// sweep) and tests/unit/crash-sweep-marker.test.mjs (its unit test).
//
// Deliberately imports nothing — no Supabase client, no env loader, no
// tests/db/localTestGuard.mjs, no node:test — so this module can be
// imported with zero environment configured. That is what lets the unit
// test in tests/unit/crash-sweep-marker.test.mjs stay a pure unit test
// instead of transitively triggering localTestGuard.mjs's import-time
// environment guard (which requires NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, and
// LOCAL_TEST_DB_MARKER — none of which exist in CI, nor should they for a
// pure regex test).
//
// Marker-scoped, never matches:
//   - any manually-seeded fixture from scripts/seed-local-automation-users.mjs
//     (fixed @test.local emails — maya.haddad@…, karim.nassar@…,
//     lina.mansour@…, zain.khalil@… — none of which start with "db-test-")
//   - any real/manual-dev user (never @test.local at all)
// because the marker regex below requires BOTH the "db-test-" prefix
// tests/db/helpers.mjs's createTestUser always uses AND the "@test.local"
// domain — nothing else can match it.

// [a-z0-9+-]+ (not just [a-z0-9-]+) so this also matches the plus-tagged
// fixture form tests/db/auth-credential-policy.test.mjs uses to prove
// plus-addressing is preserved end-to-end (db-test-plus-<uuid>+test@test.local)
// — still anchored to the literal "db-test-" prefix and "@test.local"
// domain, so nothing outside that exact shape (a real user, any other
// domain, the fixed seed personas above) can ever match.
export const CRASH_SWEEP_FIXTURE_MARKER_RE = /^db-test-[a-z0-9+-]+@test\.local$/i;

export function isCrashSweepFixtureEmail(email) {
  return typeof email === "string" && CRASH_SWEEP_FIXTURE_MARKER_RE.test(email);
}
