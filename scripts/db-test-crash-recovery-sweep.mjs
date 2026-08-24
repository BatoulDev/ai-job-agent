#!/usr/bin/env node
// scripts/db-test-crash-recovery-sweep.mjs
//
// Crash-recovery sweep for abandoned automated DB-test fixtures — the case
// where a `node --test tests/db/*.test.mjs` run was killed (Ctrl+C, a
// crashed process, a machine restart) before its own after()/safety-net
// hooks could run, leaving fixture users (and everything that cascades
// from them) permanently in the local database.
//
// Marker-scoped, never touches:
//   - any manually-seeded fixture from scripts/seed-local-automation-users.mjs
//     (fixed @test.local emails — maya.haddad@…, karim.nassar@…,
//     lina.mansour@…, zain.khalil@… — none of which start with "db-test-")
//   - any real/manual-dev user (never @test.local at all)
// because the marker regex below requires BOTH the "db-test-" prefix
// tests/db/helpers.mjs's createTestUser always uses AND the "@test.local"
// domain — nothing else can match it.
//
// Dry-run by default (reportStaleFixtures / running with no flags): only
// reports what it would delete, never deletes. Deleting requires BOTH
// --apply on the command line AND CONFIRM_CRASH_SWEEP=yes in the
// environment — two independent, explicit signals, so this can never run
// destructively as a side effect of a normal `npm run test:db` invocation.
// scripts/run-db-tests.mjs only ever calls the dry-run report.
//
// Usage:
//   node scripts/db-test-crash-recovery-sweep.mjs                     # dry run, default 60m threshold
//   node scripts/db-test-crash-recovery-sweep.mjs --max-age-minutes 30 # dry run, custom threshold
//   CONFIRM_CRASH_SWEEP=yes node scripts/db-test-crash-recovery-sweep.mjs --apply

import { fileURLToPath } from "node:url";
import path from "node:path";
import { adminClient, assertExpectedLocalProject } from "../tests/db/localTestGuard.mjs";
import { deleteFixtureUsers } from "../tests/db/fixtureCleanup.mjs";
// Pure marker logic lives in db-test-fixture-marker.mjs — deliberately
// dependency-free (no localTestGuard.mjs, no Supabase client) so
// tests/unit/crash-sweep-marker.test.mjs can import it with zero
// environment configured. Re-exported here for backward compatibility with
// any existing import of isCrashSweepFixtureEmail from this module.
import { isCrashSweepFixtureEmail } from "./db-test-fixture-marker.mjs";

export { isCrashSweepFixtureEmail };

const DEFAULT_MAX_AGE_MINUTES = 60;

function redactEmail(email) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 12)}…@${domain}`;
}

function redactId(id) {
  return `${id.slice(0, 8)}…`;
}

async function listAllUsers() {
  const users = [];
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < perPage) break;
    page += 1;
  }
  return users;
}

// Marker-scoped + age-gated: only fixtures that (a) can only have been
// created by tests/db/helpers.mjs's createTestUser, and (b) are older than
// the safety threshold, meaning they were almost certainly abandoned by a
// crashed run rather than belonging to a test still in flight.
export async function findStaleFixtures({ maxAgeMinutes = DEFAULT_MAX_AGE_MINUTES } = {}) {
  await assertExpectedLocalProject();
  const cutoff = Date.now() - maxAgeMinutes * 60_000;
  const all = await listAllUsers();
  return all
    .filter((u) => isCrashSweepFixtureEmail(u.email))
    .filter((u) => new Date(u.created_at).getTime() <= cutoff)
    .map((u) => ({ id: u.id, email: u.email, created_at: u.created_at }));
}

export async function reportStaleFixtures(options) {
  const stale = await findStaleFixtures(options);
  return {
    count: stale.length,
    redacted: stale.map((u) => ({ id: redactId(u.id), email: redactEmail(u.email), created_at: u.created_at })),
  };
}

// Deletes only when apply === true AND CONFIRM_CRASH_SWEEP=yes is set —
// see the module comment above for why both are required.
export async function sweepStaleFixtures({ apply = false, maxAgeMinutes = DEFAULT_MAX_AGE_MINUTES } = {}) {
  const stale = await findStaleFixtures({ maxAgeMinutes });
  if (!apply) {
    return { applied: false, count: stale.length };
  }
  if (process.env.CONFIRM_CRASH_SWEEP !== "yes") {
    throw new Error(
      "Refusing to apply the crash-recovery sweep: set CONFIRM_CRASH_SWEEP=yes as an explicit second confirmation."
    );
  }
  await deleteFixtureUsers(stale);
  return { applied: true, count: stale.length };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const maxAgeArgIdx = args.indexOf("--max-age-minutes");
  const maxAgeMinutes = maxAgeArgIdx !== -1 ? Number(args[maxAgeArgIdx + 1]) : DEFAULT_MAX_AGE_MINUTES;

  if (!apply) {
    const report = await reportStaleFixtures({ maxAgeMinutes });
    console.log(
      `[crash-recovery-sweep] DRY RUN — ${report.count} stale automated-test fixture user(s) older than ${maxAgeMinutes}m found.`
    );
    for (const u of report.redacted) {
      console.log(`  ${u.id}  ${u.email}  created ${u.created_at}`);
    }
    console.log(
      report.count > 0
        ? "[crash-recovery-sweep] Nothing deleted. Re-run with --apply and CONFIRM_CRASH_SWEEP=yes to delete these."
        : "[crash-recovery-sweep] Nothing to clean up."
    );
  } else {
    const result = await sweepStaleFixtures({ apply: true, maxAgeMinutes });
    console.log(`[crash-recovery-sweep] Deleted ${result.count} stale automated-test fixture user(s).`);
  }
}

const isCliEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[crash-recovery-sweep] ERROR: ${err.message}`);
    process.exit(1);
  });
}
