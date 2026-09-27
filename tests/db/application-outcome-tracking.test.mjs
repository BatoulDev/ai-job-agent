// DB tests for Phase 10's manual application-tracking RPCs
// (mark_application_sent, report_application_outcome) against the real
// local Supabase instance.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject, createTestUser, deleteTestUsers, uploadFakeCv, insertFakeAnalysis, deleteFakeJobs, createAnonClient } from "./helpers.mjs";

const jobIdsToClean = [];
let user;
let analysis;

before(async () => {
  await assertExpectedLocalProject();
  user = await createTestUser("app-outcome");
  const cv = await uploadFakeCv(user, "app-outcome.pdf");
  const created = await insertFakeAnalysis(user, cv.id);
  const { data: approved, error } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: created.id });
  if (error) throw new Error(`confirm_cv_analysis failed: ${error.message}`);
  analysis = approved;
});

after(async () => {
  await adminClient.from("application_outcomes").delete().eq("user_id", user.id);
  await adminClient.from("applications").delete().eq("user_id", user.id);
  await adminClient.from("cover_letters").delete().eq("user_id", user.id);
  await adminClient.from("matches").delete().eq("user_id", user.id);
  await deleteFakeJobs(jobIdsToClean);
  await deleteTestUsers([user]);
});

async function insertFixtureJob(overrides = {}) {
  const { data, error } = await adminClient
    .from("jobs")
    .insert({
      title: "Fixture Outcome Job",
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

async function insertApprovedMatch(job) {
  const { data, error } = await adminClient
    .from("matches")
    .insert({
      user_id: user.id,
      job_id: job.id,
      cv_analysis_id: analysis.id,
      score: 85,
      status: "user_approved",
      matching_model: "test-fixture",
      surfaced_at: new Date().toISOString(),
      decided_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(`fixture match insert failed: ${error.message}`);
  return data;
}

test("mark_application_sent: transitions an external_link application from pending_send to sent, and is idempotent", async () => {
  const job = await insertFixtureJob({ title: "External Link Mark Sent Job" });
  const match = await insertApprovedMatch(job);
  const { data: application } = await user.client.rpc("create_application", { p_match_id: match.id });
  assert.equal(application.status, "pending_send");

  const { data: marked, error } = await user.client.rpc("mark_application_sent", { p_application_id: application.id });
  assert.equal(error, null);
  assert.equal(marked.status, "sent");

  const { data: again } = await user.client.rpc("mark_application_sent", { p_application_id: application.id });
  assert.equal(again.status, "sent"); // idempotent no-op
});

test("mark_application_sent: rejects an email-method application — its status is system-tracked, never user-editable", async () => {
  const job = await insertFixtureJob({ title: "Email Job Not Manual", application_method: "email", application_email: "jobs@fixture.test" });
  const match = await insertApprovedMatch(job);
  await adminClient.from("cover_letters").insert({
    user_id: user.id,
    match_id: match.id,
    generated_content: "x".repeat(150),
    generation_status: "completed",
    approval_status: "user_approved",
    approved_content: "x".repeat(150),
    approved_at: new Date().toISOString(),
  });
  const { data: application } = await user.client.rpc("create_application", { p_match_id: match.id });

  const { error } = await user.client.rpc("mark_application_sent", { p_application_id: application.id });
  assert.notEqual(error, null);
});

test("mark_application_sent: unauthenticated call is rejected", async () => {
  const anon = createAnonClient();
  const { error } = await anon.rpc("mark_application_sent", { p_application_id: "00000000-0000-0000-0000-000000000000" });
  assert.notEqual(error, null);
});

test("mark_application_sent: cannot mark another user's application", async () => {
  const job = await insertFixtureJob({ title: "Cross User Mark Sent Job" });
  const match = await insertApprovedMatch(job);
  const { data: application } = await user.client.rpc("create_application", { p_match_id: match.id });

  const otherUser = await createTestUser("app-outcome-other");
  try {
    const { error } = await otherUser.client.rpc("mark_application_sent", { p_application_id: application.id });
    assert.notEqual(error, null);
  } finally {
    await deleteTestUsers([otherUser]);
  }
});

test("report_application_outcome: rejects reporting for an application that hasn't actually been sent yet", async () => {
  const job = await insertFixtureJob({ title: "Not Sent Yet Job" });
  const match = await insertApprovedMatch(job);
  const { data: application } = await user.client.rpc("create_application", { p_match_id: match.id });
  assert.equal(application.status, "pending_send");

  const { error } = await user.client.rpc("report_application_outcome", { p_application_id: application.id, p_outcome_status: "interviewing" });
  assert.notEqual(error, null);
});

test("report_application_outcome: rejects an invalid outcome_status", async () => {
  const job = await insertFixtureJob({ title: "Invalid Status Job" });
  const match = await insertApprovedMatch(job);
  const { data: application } = await user.client.rpc("create_application", { p_match_id: match.id });
  await user.client.rpc("mark_application_sent", { p_application_id: application.id });

  const { error } = await user.client.rpc("report_application_outcome", { p_application_id: application.id, p_outcome_status: "definitely_hired" });
  assert.notEqual(error, null);
});

test("report_application_outcome: records a manual outcome, upserts on re-report, and writes an audit event", async () => {
  const job = await insertFixtureJob({ title: "Report Outcome Job" });
  const match = await insertApprovedMatch(job);
  const { data: application } = await user.client.rpc("create_application", { p_match_id: match.id });
  await user.client.rpc("mark_application_sent", { p_application_id: application.id });

  const { data: reported, error } = await user.client.rpc("report_application_outcome", {
    p_application_id: application.id,
    p_outcome_status: "interviewing",
    p_notes: "Phone screen scheduled.",
  });
  assert.equal(error, null);
  assert.equal(reported.outcome_status, "interviewing");
  assert.equal(reported.source, "user_manual");

  // Re-report (upsert, not a duplicate row).
  const { data: updated } = await user.client.rpc("report_application_outcome", { p_application_id: application.id, p_outcome_status: "offer" });
  assert.equal(updated.id, reported.id);
  assert.equal(updated.outcome_status, "offer");

  const { data: rows } = await adminClient.from("application_outcomes").select("*").eq("application_id", application.id);
  assert.equal(rows.length, 1, "must upsert the single current-outcome row, never duplicate");

  const { data: events } = await adminClient
    .from("audit_events")
    .select("event_type, metadata")
    .eq("entity_type", "application")
    .eq("entity_id", application.id)
    .eq("event_type", "application_outcome_reported");
  assert.equal(events.length, 2, "one audit event per report call");
});

test("report_application_outcome: never returns or affects another user's application", async () => {
  const job = await insertFixtureJob({ title: "Cross User Outcome Job" });
  const match = await insertApprovedMatch(job);
  const { data: application } = await user.client.rpc("create_application", { p_match_id: match.id });
  await user.client.rpc("mark_application_sent", { p_application_id: application.id });

  const otherUser = await createTestUser("app-outcome-other2");
  try {
    const { error } = await otherUser.client.rpc("report_application_outcome", { p_application_id: application.id, p_outcome_status: "rejected" });
    assert.notEqual(error, null);
  } finally {
    await deleteTestUsers([otherUser]);
  }
});

test("application_outcomes RLS: an anonymous read is rejected", async () => {
  const anon = createAnonClient();
  const { data, error } = await anon.from("application_outcomes").select("*");
  // RLS blocks anon (no policy grants anon select) — either an error or an empty result is acceptable, but never another user's row.
  if (!error) assert.equal(data.length, 0);
});
