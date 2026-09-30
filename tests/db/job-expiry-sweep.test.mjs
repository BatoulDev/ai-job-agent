// DB tests for public.expire_due_jobs() (Model C, founder decision
// 2026-09-30) — the hourly expiry-sweep primitive. Not scheduled/activated
// by anything; see n8n-workflows/job-expiry-sweep.ts (prepared, inactive).
// supabase/migrations/20260930160000_add_model_c_active_capacity_and_daily_limits.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject, deleteFakeJobs } from "./helpers.mjs";

async function insertJob(jobIdsToClean, overrides = {}) {
  const { data, error } = await adminClient
    .from("jobs")
    .insert({
      title: "Fixture Expiry Job",
      company_name: "Fixture Co",
      description: "A fake job fixture for automated tests only.",
      application_method: "external_link",
      application_url: "https://example.test/apply",
      source_type: "admin_manual",
      status: "active",
      ...overrides,
    })
    .select()
    .single();
  if (error) throw new Error(`fixture job insert failed: ${error.message}`);
  jobIdsToClean.push(data.id);
  return data;
}

async function runSweep() {
  const { data, error } = await adminClient.rpc("expire_due_jobs");
  if (error) throw new Error(`expire_due_jobs failed: ${error.message}`);
  return data ?? [];
}

test("expire_due_jobs: an active job whose expires_at has already passed transitions to expired", async () => {
  await assertExpectedLocalProject();
  const jobIdsToClean = [];
  try {
    const job = await insertJob(jobIdsToClean, { expires_at: new Date(Date.now() - 3600_000).toISOString() });
    const result = await runSweep();
    assert.ok(result.some((r) => r.job_id === job.id));

    const { data: row } = await adminClient.from("jobs").select("status, status_reason, closed_at").eq("id", job.id).single();
    assert.equal(row.status, "expired");
    assert.equal(row.status_reason, "expired_by_deadline_sweep");
    assert.ok(row.closed_at, "the existing jobs_set_closed_at trigger must stamp closed_at automatically");
  } finally {
    await deleteFakeJobs(jobIdsToClean);
  }
});

test("expire_due_jobs: an active job whose closing_date has already passed transitions to expired", async () => {
  const jobIdsToClean = [];
  try {
    const job = await insertJob(jobIdsToClean, { closing_date: new Date(Date.now() - 3600_000).toISOString() });
    const result = await runSweep();
    assert.ok(result.some((r) => r.job_id === job.id));

    const { data: row } = await adminClient.from("jobs").select("status").eq("id", job.id).single();
    assert.equal(row.status, "expired");
  } finally {
    await deleteFakeJobs(jobIdsToClean);
  }
});

test("expire_due_jobs: a job with a future expires_at/closing_date remains active", async () => {
  const jobIdsToClean = [];
  try {
    const job = await insertJob(jobIdsToClean, { expires_at: new Date(Date.now() + 30 * 86400000).toISOString() });
    await runSweep();
    const { data: row } = await adminClient.from("jobs").select("status").eq("id", job.id).single();
    assert.equal(row.status, "active", "a deadline that has not yet passed must never be expired early");
  } finally {
    await deleteFakeJobs(jobIdsToClean);
  }
});

test("expire_due_jobs: a job with no expires_at/closing_date at all is never touched", async () => {
  const jobIdsToClean = [];
  try {
    const job = await insertJob(jobIdsToClean);
    const result = await runSweep();
    assert.ok(!result.some((r) => r.job_id === job.id));
    const { data: row } = await adminClient.from("jobs").select("status").eq("id", job.id).single();
    assert.equal(row.status, "active");
  } finally {
    await deleteFakeJobs(jobIdsToClean);
  }
});

test("expire_due_jobs: is idempotent — running it twice in a row does not error and does not re-process", async () => {
  const jobIdsToClean = [];
  try {
    const job = await insertJob(jobIdsToClean, { expires_at: new Date(Date.now() - 3600_000).toISOString() });
    const first = await runSweep();
    assert.ok(first.some((r) => r.job_id === job.id));

    const second = await runSweep();
    assert.ok(!second.some((r) => r.job_id === job.id), "an already-expired job must not be reported/reprocessed on a repeat run");

    const { data: row } = await adminClient.from("jobs").select("status").eq("id", job.id).single();
    assert.equal(row.status, "expired");
  } finally {
    await deleteFakeJobs(jobIdsToClean);
  }
});

for (const untouchedStatus of ["closed", "unavailable", "rejected", "source_error", "pending_review"]) {
  test(`expire_due_jobs: never touches a job already in status '${untouchedStatus}', even with a past deadline`, async () => {
    const jobIdsToClean = [];
    try {
      const job = await insertJob(jobIdsToClean, { status: untouchedStatus, expires_at: new Date(Date.now() - 3600_000).toISOString() });
      const result = await runSweep();
      assert.ok(!result.some((r) => r.job_id === job.id));
      const { data: row } = await adminClient.from("jobs").select("status").eq("id", job.id).single();
      assert.equal(row.status, untouchedStatus, "the sweep must only ever transition active -> expired, never any other status");
    } finally {
      await deleteFakeJobs(jobIdsToClean);
    }
  });
}

test("expire_due_jobs: never deletes rows — the job remains retrievable by id after expiring", async () => {
  const jobIdsToClean = [];
  try {
    const job = await insertJob(jobIdsToClean, { expires_at: new Date(Date.now() - 3600_000).toISOString() });
    await runSweep();
    const { data: row, error } = await adminClient.from("jobs").select("id, title").eq("id", job.id).maybeSingle();
    assert.equal(error, null);
    assert.ok(row, "the job row must still exist — expiry is a status transition, never a delete");
    assert.equal(row.title, job.title);
  } finally {
    await deleteFakeJobs(jobIdsToClean);
  }
});

test("an expired job is excluded by the same status='active' filter the matching shortlist relies on", async () => {
  const jobIdsToClean = [];
  try {
    const job = await insertJob(jobIdsToClean, { expires_at: new Date(Date.now() - 3600_000).toISOString() });
    await runSweep();

    const { data: activeJobs, error } = await adminClient.from("jobs").select("id").eq("status", "active").eq("id", job.id);
    assert.equal(error, null);
    assert.equal(activeJobs.length, 0, "shortlistJobsForUser's own .eq('status','active') query must never see this job again");
  } finally {
    await deleteFakeJobs(jobIdsToClean);
  }
});

test("matches_user_job_analysis_key: the database itself rejects a duplicate (user, job, analysis) match — no rescoring race can ever duplicate it", async () => {
  const { createTestUser, deleteTestUsers, uploadFakeCv, insertFakeAnalysis } = await import("./helpers.mjs");
  const jobIdsToClean = [];
  const user = await createTestUser("expiry-dup-match");
  try {
    const cv = await uploadFakeCv(user, "expiry-dup-match.pdf");
    const created = await insertFakeAnalysis(user, cv.id);
    const { data: analysis, error } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: created.id });
    if (error) throw new Error(`confirm_cv_analysis failed: ${error.message}`);

    const job = await insertJob(jobIdsToClean, { title: "Dup Match Job" });
    const { error: firstError } = await adminClient.from("matches").insert({ user_id: user.id, job_id: job.id, cv_analysis_id: analysis.id, score: 80, matching_model: "test-fixture" });
    assert.equal(firstError, null);

    const { error: secondError } = await adminClient.from("matches").insert({ user_id: user.id, job_id: job.id, cv_analysis_id: analysis.id, score: 90, matching_model: "test-fixture" });
    assert.notEqual(secondError, null, "a second match row for the identical (user, job, analysis) triple must be rejected by the DB");
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});

test("get_my_matches: an approved match's full history (score, explanation, job details) remains retrievable after its job expires", async () => {
  const { createTestUser, deleteTestUsers, uploadFakeCv, insertFakeAnalysis } = await import("./helpers.mjs");
  const jobIdsToClean = [];
  const user = await createTestUser("expiry-history");
  try {
    const cv = await uploadFakeCv(user, "expiry-history.pdf");
    const created = await insertFakeAnalysis(user, cv.id);
    const { data: analysis, error } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: created.id });
    if (error) throw new Error(`confirm_cv_analysis failed: ${error.message}`);

    const job = await insertJob(jobIdsToClean, { title: "History Preserved Job", expires_at: new Date(Date.now() - 3600_000).toISOString() });
    const { data: match, error: matchError } = await adminClient
      .from("matches")
      .insert({
        user_id: user.id,
        job_id: job.id,
        cv_analysis_id: analysis.id,
        score: 91,
        explanation: "Strong historical overlap.",
        status: "user_approved",
        matching_model: "test-fixture",
        surfaced_at: new Date().toISOString(),
        decided_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (matchError) throw new Error(`fixture match insert failed: ${matchError.message}`);

    await runSweep();

    const { data: rows, error: historyError } = await user.client.rpc("get_my_matches", { p_status: "user_approved" });
    if (historyError) throw new Error(`get_my_matches failed: ${historyError.message}`);
    const found = rows.find((r) => r.match_id === match.id);
    assert.ok(found, "the match must remain retrievable after its job expires");
    assert.equal(found.job_title, "History Preserved Job");
    assert.equal(found.job_status, "expired", "the real current job status is exposed, not hidden");
    assert.equal(found.score, 91);
    assert.equal(found.explanation, "Strong historical overlap.");
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});
