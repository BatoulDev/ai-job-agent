#!/usr/bin/env node
// scripts/cleanup-remediation-fixtures.mjs
//
// Narrowly-scoped recovery for tests/db/upsert-job-with-locations-
// remediation.test.mjs fixtures (Checkpoint 2C corrective fix,
// 20261027090000). That test file's own after() hook already deletes
// every job it creates on normal completion (even on an assertion
// failure within a test — node:test still runs after() for the file).
// This script exists ONLY for the one gap after() cannot cover: a hard
// process crash (OOM, SIGKILL) that skips after() entirely — the same
// residual gap tests/db/helpers.mjs already documents for its own user
// fixtures via scripts/db-test-crash-recovery-sweep.mjs.
//
// LOCAL TEST DATABASE ONLY. Imports tests/db/localTestGuard.mjs, which
// enforces (at import time, before this script does anything):
//   1. NEXT_PUBLIC_SUPABASE_URL host is 127.0.0.1/localhost/[::1] only
//   2. LOCAL_TEST_DB_MARKER matches the exact required local-only value
//   3. the connected project's public.plans catalog matches this
//      project's canonical rows
// This script refuses to run against anything else — never production,
// never a remote project, regardless of what any flag claims.
//
// Selection criteria (all five must match — never a bare external_id
// prefix alone) mirrors tests/db/upsert-job-with-locations-remediation.
// test.mjs's baseJob() fixture shape exactly, so a real job could never
// accidentally satisfy every field at once:
//   external_id LIKE 'remediation-fixture-%'
//   AND source_type = 'admin_manual'
//   AND title = 'Remediation Fixture Job'
//   AND company_name = 'Remediation Fixture Co'
//   AND application_url = 'https://example.test/apply'
// job_locations rows for a matched job are removed automatically by the
// existing `on delete cascade` (job_locations.job_id -> jobs.id,
// 20261026090000) — no separate deletion needed here.
//
// Usage:
//   node scripts/cleanup-remediation-fixtures.mjs           # dry run (default, writes nothing)
//   node scripts/cleanup-remediation-fixtures.mjs --apply   # actually delete the matched rows

import { adminClient, assertExpectedLocalProject } from "../tests/db/localTestGuard.mjs";

const isApply = process.argv.slice(2).includes("--apply");

const SELECTION = {
  source_type: "admin_manual",
  title: "Remediation Fixture Job",
  company_name: "Remediation Fixture Co",
  application_url: "https://example.test/apply",
};

async function main() {
  await assertExpectedLocalProject();

  const { data: matches, error } = await adminClient
    .from("jobs")
    .select("id, external_id, title, company_name, created_at")
    .like("external_id", "remediation-fixture-%")
    .match(SELECTION);
  if (error) {
    console.error(`[cleanup-remediation-fixtures] ERROR: failed to query jobs: ${error.message}`);
    process.exit(1);
  }

  if (matches.length === 0) {
    console.log("[cleanup-remediation-fixtures] No matching fixture rows found. Nothing to do.");
    return;
  }

  console.log(`[cleanup-remediation-fixtures] ${matches.length} matching fixture row(s):`);
  for (const row of matches) {
    console.log(`  - ${row.id}  external_id=${row.external_id}  created_at=${row.created_at}`);
  }

  if (!isApply) {
    console.log("\n[cleanup-remediation-fixtures] Dry run only — pass --apply to delete the rows listed above.");
    return;
  }

  const ids = matches.map((r) => r.id);
  const { error: deleteError } = await adminClient.from("jobs").delete().in("id", ids);
  if (deleteError) {
    console.error(`[cleanup-remediation-fixtures] ERROR: delete failed: ${deleteError.message}`);
    process.exit(1);
  }

  const { count, error: verifyError } = await adminClient
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .like("external_id", "remediation-fixture-%")
    .match(SELECTION);
  if (verifyError) {
    console.error(`[cleanup-remediation-fixtures] ERROR: post-delete verification failed: ${verifyError.message}`);
    process.exit(1);
  }
  if ((count ?? 0) !== 0) {
    console.error(`[cleanup-remediation-fixtures] ERROR: ${count} matching row(s) still remain after delete.`);
    process.exit(1);
  }

  console.log(`\n[cleanup-remediation-fixtures] Deleted ${ids.length} fixture row(s). Verified 0 remain.`);
}

main();
