// DB tests for Phase 09's application send pipeline
// (src/lib/applications/{sendApplication,buildEmailPayload,findPendingApplications}.ts)
// against the real local Supabase instance, including real Storage access
// for the CV attachment. Uses MockEmailTransport exclusively — no real
// network call is ever made; this is the safety requirement for Phase 09.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject, createTestUser, deleteTestUsers, uploadFakeCv, insertFakeAnalysis, deleteFakeJobs } from "./helpers.mjs";
import { attemptSendApplicationEmail } from "../../src/lib/applications/sendApplication.ts";
import { findPendingEmailApplicationIds } from "../../src/lib/applications/findPendingApplications.ts";
import { MockEmailTransport } from "../../src/lib/applications/emailTransport.ts";

const jobIdsToClean = [];
let user;
let analysis;

before(async () => {
  await assertExpectedLocalProject();
  user = await createTestUser("app-sending");
  const cv = await uploadFakeCv(user, "app-sending.pdf");
  const created = await insertFakeAnalysis(user, cv.id);
  const { data: approved, error } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: created.id });
  if (error) throw new Error(`confirm_cv_analysis failed: ${error.message}`);
  analysis = approved;
});

after(async () => {
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
      title: "Fixture Send Job",
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

async function insertApprovedMatchWithApprovedCoverLetter(job) {
  const { data: match, error: matchError } = await adminClient
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
  if (matchError) throw new Error(`fixture match insert failed: ${matchError.message}`);

  const { data: letter, error: letterError } = await adminClient
    .from("cover_letters")
    .insert({
      user_id: user.id,
      match_id: match.id,
      generated_content: "x".repeat(150),
      generation_status: "completed",
      approval_status: "user_approved",
      approved_content: "Dear Hiring Team,\n\nThis is my approved cover letter body.\n\nSincerely,",
      approved_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (letterError) throw new Error(`fixture cover letter insert failed: ${letterError.message}`);

  return { match, letter };
}

test("attemptSendApplicationEmail: sends via the mock transport, persists status/provider id, and writes both audit events", async () => {
  const job = await insertFixtureJob({ title: "Email Send Job", application_method: "email", application_email: "jobs@fixture.test" });
  const { match } = await insertApprovedMatchWithApprovedCoverLetter(job);

  const { data: application, error } = await user.client.rpc("create_application", { p_match_id: match.id });
  if (error) throw new Error(`create_application failed: ${error.message}`);
  assert.equal(application.status, "pending_send");

  const transport = new MockEmailTransport();
  const outcome = await attemptSendApplicationEmail(adminClient, application.id, transport);
  assert.equal(outcome, "sent");

  const { data: row } = await adminClient.from("applications").select("*").eq("id", application.id).single();
  assert.equal(row.status, "sent");
  assert.match(row.provider_message_id, /^mock-/);
  assert.equal(row.last_error, null);
  assert.equal(row.send_attempt_count, 1);

  assert.equal(transport.sentPayloads.length, 1);
  const sent = transport.sentPayloads[0];
  assert.equal(sent.to, "jobs@fixture.test");
  assert.equal(sent.subject, "Application for Email Send Job at Fixture Co");
  assert.equal(sent.body, "Dear Hiring Team,\n\nThis is my approved cover letter body.\n\nSincerely,");
  assert.equal(sent.attachments.length, 1);
  assert.equal(sent.attachments[0].filename, "app-sending.pdf");

  const { data: events } = await adminClient
    .from("audit_events")
    .select("event_type, metadata")
    .eq("entity_type", "application")
    .eq("entity_id", application.id)
    .order("created_at", { ascending: true });
  // create_application() itself already wrote 'application_approved' — the
  // send attempt adds exactly the two events below on top of that.
  assert.deepEqual(
    events.map((e) => e.event_type),
    ["application_approved", "application_send_attempted", "application_send_result"]
  );
  assert.equal(events[2].metadata.outcome, "sent");
  // Never leaks cover-letter/CV content into audit metadata (AGENTS.md §19/§29).
  assert.ok(!JSON.stringify(events).includes("approved cover letter body"));
});

test("attemptSendApplicationEmail: a second attempt on an already-sent application is a safe no-op", async () => {
  const job = await insertFixtureJob({ title: "Already Sent Job", application_method: "email", application_email: "jobs2@fixture.test" });
  const { match } = await insertApprovedMatchWithApprovedCoverLetter(job);
  const { data: application } = await user.client.rpc("create_application", { p_match_id: match.id });

  const transport = new MockEmailTransport();
  await attemptSendApplicationEmail(adminClient, application.id, transport);
  const secondOutcome = await attemptSendApplicationEmail(adminClient, application.id, transport);

  assert.equal(secondOutcome, "already_claimed");
  assert.equal(transport.sentPayloads.length, 1, "the mock transport must never be called twice for the same application");
});

test("attemptSendApplicationEmail: two concurrent attempts on the same application — exactly one sends", async () => {
  const job = await insertFixtureJob({ title: "Concurrent Send Job", application_method: "email", application_email: "jobs3@fixture.test" });
  const { match } = await insertApprovedMatchWithApprovedCoverLetter(job);
  const { data: application } = await user.client.rpc("create_application", { p_match_id: match.id });

  const transport = new MockEmailTransport();
  const [a, b] = await Promise.all([
    attemptSendApplicationEmail(adminClient, application.id, transport),
    attemptSendApplicationEmail(adminClient, application.id, transport),
  ]);
  const outcomes = [a, b].sort();
  assert.deepEqual(outcomes, ["already_claimed", "sent"]);
  assert.equal(transport.sentPayloads.length, 1, "only one of the two concurrent attempts must actually send");
});

test("attemptSendApplicationEmail: an external_link application is never touched (not_email_method)", async () => {
  const job = await insertFixtureJob({ title: "External Link Job" }); // default external_link
  const { match } = await insertApprovedMatchWithApprovedCoverLetter(job);
  const { data: application } = await user.client.rpc("create_application", { p_match_id: match.id });
  assert.equal(application.application_method, "external_link");

  const transport = new MockEmailTransport();
  const outcome = await attemptSendApplicationEmail(adminClient, application.id, transport);
  assert.equal(outcome, "not_email_method");
  assert.equal(transport.sentPayloads.length, 0);

  const { data: row } = await adminClient.from("applications").select("status").eq("id", application.id).single();
  assert.equal(row.status, "pending_send", "an external_link application must be left untouched for the user's own manual apply-and-confirm flow");
});

test("findPendingEmailApplicationIds: only returns pending_send email applications, never external_link ones", async () => {
  const emailJob = await insertFixtureJob({ title: "Pending Discovery Email Job", application_method: "email", application_email: "jobs4@fixture.test" });
  const linkJob = await insertFixtureJob({ title: "Pending Discovery Link Job" });
  const { match: emailMatch } = await insertApprovedMatchWithApprovedCoverLetter(emailJob);
  const { match: linkMatch } = await insertApprovedMatchWithApprovedCoverLetter(linkJob);
  const { data: emailApp } = await user.client.rpc("create_application", { p_match_id: emailMatch.id });
  const { data: linkApp } = await user.client.rpc("create_application", { p_match_id: linkMatch.id });

  const ids = await findPendingEmailApplicationIds(adminClient, 50);
  assert.ok(ids.includes(emailApp.id));
  assert.ok(!ids.includes(linkApp.id));
});
