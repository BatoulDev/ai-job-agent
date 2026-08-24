#!/usr/bin/env node
// scripts/run-db-tests.mjs
//
// Orchestrates `node --test tests/db/*.test.mjs` with the safety
// guarantees required for sharing the local Supabase instance with manual
// development (there is no separate test database/project — see
// docs/PRODUCTION_READINESS.md):
//
//  1. Verifies the local-test environment guard (tests/db/localTestGuard.mjs)
//     before doing anything.
//  2. Reports (dry-run only, via scripts/db-test-crash-recovery-sweep.mjs)
//     any stale fixtures left by a previous crashed run. Never deletes
//     automatically — that requires a separate, explicitly-approved step.
//  3. Runs the DB test files with --test-concurrency=1, so no two test
//     files ever hit the same local GoTrue instance at once. This is the
//     confirmed root cause of the ~134 orphaned fixture users found before
//     this change: concurrent test files racing createUser/deleteUser
//     against one local GoTrue instance produced intermittent deleteUser
//     failures that the old cleanup code only logged and ignored.
//  4. After the run, verifies zero fixtures tagged with this run's id
//     remain (defense in depth on top of every file's own after() hooks
//     and the safety-net hook in tests/db/helpers.mjs). If any do, it
//     retries cleanup once more; if that still fails, the run is reported
//     as failed — a cleanup failure must never be silently swallowed.
//
// Usage:
//   node scripts/run-db-tests.mjs                          # all tests/db/*.test.mjs
//   node scripts/run-db-tests.mjs tests/db/some.test.mjs …  # a specific subset

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertExpectedLocalProject, adminClient } from "../tests/db/localTestGuard.mjs";
import { deleteFixtureUsers } from "../tests/db/fixtureCleanup.mjs";
import { reportStaleFixtures } from "./db-test-crash-recovery-sweep.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function defaultTestFiles() {
  const dbDir = path.join(projectRoot, "tests", "db");
  return readdirSync(dbDir)
    .filter((f) => f.endsWith(".test.mjs"))
    .sort()
    .map((f) => path.join("tests", "db", f));
}

async function listUsersMatching(predicate) {
  const matches = [];
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    for (const u of data.users) {
      if (predicate(u)) matches.push(u);
    }
    if (data.users.length < perPage) break;
    page += 1;
  }
  return matches;
}

async function main() {
  // Guard #1-3 (hostname allowlist, LOCAL_TEST_DB_MARKER, canonical
  // catalog) — importing localTestGuard.mjs already ran guards #1-#2
  // synchronously; this runs guard #3.
  await assertExpectedLocalProject();

  const testRunId = randomUUID();
  const runIdShort = testRunId.replace(/-/g, "").slice(0, 8);
  console.log(`[test:db] run ${runIdShort} — environment guard passed, starting`);

  // Report-only crash-recovery check. Never deletes here — see
  // scripts/db-test-crash-recovery-sweep.mjs for the explicit,
  // double-confirmed --apply path.
  const staleReport = await reportStaleFixtures();
  if (staleReport.count > 0) {
    console.log(
      `[test:db] NOTE: ${staleReport.count} stale automated-test fixture user(s) from a previous run are present ` +
        "(not deleted automatically). Review with: node scripts/db-test-crash-recovery-sweep.mjs"
    );
  }

  const args = process.argv.slice(2);
  const testFiles = args.length > 0 ? args : defaultTestFiles();

  const exitCode = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...testFiles], {
      cwd: projectRoot,
      stdio: "inherit",
      env: { ...process.env, TEST_RUN_ID: testRunId },
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      console.error(`[test:db] failed to start test process: ${err.message}`);
      resolve(1);
    });
  });

  // Post-run verification: confirm nothing tagged with this run's id
  // remains, regardless of whether the tests themselves passed or failed.
  console.log(`[test:db] run ${runIdShort} — verifying no fixtures from this run remain`);
  const leftover = await listUsersMatching((u) => u.email && u.email.includes(`-${runIdShort}-`));

  if (leftover.length > 0) {
    console.error(
      `[test:db] run ${runIdShort}: ${leftover.length} fixture(s) from this run were not cleaned up by test hooks. Retrying cleanup...`
    );
    try {
      await deleteFixtureUsers(leftover.map((u) => ({ id: u.id })));
      console.error(
        `[test:db] run ${runIdShort}: cleanup retry succeeded, but a hook-cleanup gap was detected — investigate ` +
          "why the file/safety-net after() hooks did not already remove these."
      );
    } catch (err) {
      console.error(
        `[test:db] run ${runIdShort}: FAILED — ${leftover.length} fixture(s) could not be cleaned up even after retry: ${err.message}`
      );
      process.exit(1);
    }
  } else {
    console.log(`[test:db] run ${runIdShort}: verified — zero fixtures from this run remain.`);
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`[test:db] fatal: ${err.message}`);
  process.exit(1);
});
