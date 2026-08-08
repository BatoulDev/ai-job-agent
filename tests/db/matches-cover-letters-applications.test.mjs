// Phase 10 — Matches, cover letters, applications.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  createTestUser,
  deleteTestUsers,
  uploadFakeCv,
  insertFakeAnalysis,
  insertFakeJob,
  deleteFakeJobs,
} from "./helpers.mjs";

let userA;
let userB;
let approvedAnalysis;
let job;
let linkedinJob;
const jobIdsToClean = [];

async function insertFakeMatch(overrides = {}) {
  const { data, error } = await adminClient
    .from("matches")
    .insert({
      user_id: userA.id,
      job_id: job.id,
      cv_analysis_id: approvedAnalysis.id,
      score: 80,
      ...overrides,
    })
    .select()
    .single();
  if (error) throw new Error(`insertFakeMatch failed: ${error.message}`);
  return data;
}

before(async () => {
  await assertExpectedLocalProject();
  userA = await createTestUser("match-a");
  userB = await createTestUser("match-b");

  const cv = await uploadFakeCv(userA, "match-fixture.pdf");
  const analysis = await insertFakeAnalysis(userA, cv.id);
  const { data: confirmed } = await userA.client.rpc("confirm_cv_analysis", { p_analysis_id: analysis.id });
  approvedAnalysis = confirmed;

  job = await insertFakeJob({ title: "Match fixture job" });
  linkedinJob = await insertFakeJob({
    title: "LinkedIn fixture job",
    source_type: "linkedin",
    application_method: "external_link",
  });
  jobIdsToClean.push(job.id, linkedinJob.id);
});

after(async () => {
  await deleteFakeJobs(jobIdsToClean);
  await deleteTestUsers([userA, userB]);
});

test("a match must reference an approved cv_analysis (DB-enforced)", async () => {
  const cv = await uploadFakeCv(userB, "unapproved.pdf");
  const unapprovedAnalysis = await insertFakeAnalysis(userB, cv.id);

  const { error } = await adminClient.from("matches").insert({
    user_id: userB.id,
    job_id: job.id,
    cv_analysis_id: unapprovedAnalysis.id,
    score: 50,
  });
  assert.notEqual(error, null);
});

test("score bounds are enforced", async () => {
  const { error: tooHigh } = await adminClient.from("matches").insert({
    user_id: userA.id,
    job_id: job.id,
    cv_analysis_id: approvedAnalysis.id,
    score: 101,
  });
  assert.notEqual(tooHigh, null);

  const { error: negative } = await adminClient.from("matches").insert({
    user_id: userA.id,
    job_id: job.id,
    cv_analysis_id: approvedAnalysis.id,
    score: -1,
  });
  assert.notEqual(negative, null);
});

test("match uniqueness prevents duplicate rerun records", async () => {
  const match = await insertFakeMatch();
  const { error } = await adminClient.from("matches").insert({
    user_id: userA.id,
    job_id: job.id,
    cv_analysis_id: approvedAnalysis.id,
    score: 90,
  });
  assert.notEqual(error, null);
  await adminClient.from("matches").delete().eq("id", match.id);
});

test("users see only their own matches", async () => {
  const match = await insertFakeMatch();
  const { data: ownView } = await userA.client.from("matches").select("id").eq("id", match.id).maybeSingle();
  assert.notEqual(ownView, null);

  const { data: otherView } = await userB.client.from("matches").select("id").eq("id", match.id).maybeSingle();
  assert.equal(otherView, null);
  await adminClient.from("matches").delete().eq("id", match.id);
});

test("approve_match / reject_match: ownership-checked, idempotent, one decision only", async () => {
  const match = await insertFakeMatch();

  const { error: crossUserError } = await userB.client.rpc("approve_match", { p_match_id: match.id });
  assert.notEqual(crossUserError, null);

  const { data: approved, error } = await userA.client.rpc("approve_match", { p_match_id: match.id });
  assert.equal(error, null);
  assert.equal(approved.status, "user_approved");

  const { data: idempotent } = await userA.client.rpc("approve_match", { p_match_id: match.id });
  assert.equal(idempotent.status, "user_approved");

  const { error: rejectAfterApprove } = await userA.client.rpc("reject_match", { p_match_id: match.id });
  assert.notEqual(rejectAfterApprove, null);

  await adminClient.from("matches").delete().eq("id", match.id);
});

test("cover letter: generated is never auto-approved; only owner can approve their own version", async () => {
  const match = await insertFakeMatch();
  await userA.client.rpc("approve_match", { p_match_id: match.id });

  const { data: coverLetter } = await adminClient
    .from("cover_letters")
    .insert({
      user_id: userA.id,
      match_id: match.id,
      generated_content: "Dear hiring manager, ...",
      generation_status: "completed",
    })
    .select()
    .single();
  assert.equal(coverLetter.approval_status, "draft");

  const { error: crossUserError } = await userB.client.rpc("approve_cover_letter", {
    p_cover_letter_id: coverLetter.id,
  });
  assert.notEqual(crossUserError, null);

  const { data: edited } = await userA.client.rpc("save_cover_letter_edit", {
    p_cover_letter_id: coverLetter.id,
    p_edited_content: "Dear hiring manager, edited by user...",
  });
  assert.equal(edited.approval_status, "draft");

  const { data: approvedLetter, error } = await userA.client.rpc("approve_cover_letter", {
    p_cover_letter_id: coverLetter.id,
  });
  assert.equal(error, null);
  assert.equal(approvedLetter.approval_status, "user_approved");
  assert.equal(approvedLetter.approved_content, "Dear hiring manager, edited by user...");

  // The approved version is unambiguous: further edits never change it.
  const { error: editAfterApprove } = await userA.client.rpc("save_cover_letter_edit", {
    p_cover_letter_id: coverLetter.id,
    p_edited_content: "Should be rejected",
  });
  assert.notEqual(editAfterApprove, null);

  await adminClient.from("cover_letters").delete().eq("id", coverLetter.id);
  await adminClient.from("matches").delete().eq("id", match.id);
});

test("application cannot become sendable without explicit approval; duplicate send is prevented", async () => {
  const match = await insertFakeMatch();

  const { error: beforeApproval } = await userA.client.rpc("create_application", { p_match_id: match.id });
  assert.notEqual(beforeApproval, null);

  await userA.client.rpc("approve_match", { p_match_id: match.id });

  const { data: application, error } = await userA.client.rpc("create_application", { p_match_id: match.id });
  assert.equal(error, null);
  assert.notEqual(application.approved_at, null);
  assert.equal(application.approved_by, userA.id);
  assert.equal(application.status, "pending_send");

  // Idempotent: a second click reuses the same active application.
  const { data: again } = await userA.client.rpc("create_application", { p_match_id: match.id });
  assert.equal(again.id, application.id);

  await adminClient.from("applications").delete().eq("id", application.id);
  await adminClient.from("matches").delete().eq("id", match.id);
});

test("LinkedIn-sourced application can never use email send status", async () => {
  const { data: linkedinMatch } = await adminClient
    .from("matches")
    .insert({ user_id: userA.id, job_id: linkedinJob.id, cv_analysis_id: approvedAnalysis.id, score: 70 })
    .select()
    .single();

  const { error } = await adminClient.from("applications").insert({
    user_id: userA.id,
    match_id: linkedinMatch.id,
    job_id: linkedinJob.id,
    application_method: "email",
    approved_at: new Date().toISOString(),
    approved_by: userA.id,
    idempotency_key: `test-linkedin-${linkedinMatch.id}`,
  });
  assert.notEqual(error, null);

  await adminClient.from("matches").delete().eq("id", linkedinMatch.id);
});

test("duplicate idempotency key is rejected", async () => {
  const match = await insertFakeMatch();
  const key = `test-idem-${match.id}`;

  const { error: firstError } = await adminClient.from("applications").insert({
    user_id: userA.id,
    match_id: match.id,
    job_id: job.id,
    application_method: "external_link",
    approved_at: new Date().toISOString(),
    approved_by: userA.id,
    idempotency_key: key,
    status: "failed",
  });
  assert.equal(firstError, null);

  const { error: dupError } = await adminClient.from("applications").insert({
    user_id: userA.id,
    match_id: match.id,
    job_id: job.id,
    application_method: "external_link",
    approved_at: new Date().toISOString(),
    approved_by: userA.id,
    idempotency_key: key,
    status: "failed",
  });
  assert.notEqual(dupError, null);

  await adminClient.from("applications").delete().eq("match_id", match.id);
  await adminClient.from("matches").delete().eq("id", match.id);
});

test("approval evidence and send-success remain separate states", async () => {
  const match = await insertFakeMatch();
  const { data: application } = await adminClient
    .from("applications")
    .insert({
      user_id: userA.id,
      match_id: match.id,
      job_id: job.id,
      application_method: "external_link",
      approved_at: new Date().toISOString(),
      approved_by: userA.id,
      idempotency_key: `test-separate-${match.id}`,
    })
    .select()
    .single();

  assert.equal(application.status, "pending_send");
  assert.notEqual(application.approved_at, null);
  // Approval happened, but nothing indicates a send occurred yet.
  assert.equal(application.provider_message_id, null);
  assert.equal(application.send_attempt_count, 0);

  await adminClient.from("applications").delete().eq("id", application.id);
  await adminClient.from("matches").delete().eq("id", match.id);
});

test("cross-user access to matches/applications is rejected", async () => {
  const match = await insertFakeMatch();
  await userA.client.rpc("approve_match", { p_match_id: match.id });
  const { data: application } = await userA.client.rpc("create_application", { p_match_id: match.id });

  const { data: otherMatchView } = await userB.client.from("matches").select("id").eq("id", match.id).maybeSingle();
  assert.equal(otherMatchView, null);

  const { data: otherAppView } = await userB.client
    .from("applications")
    .select("id")
    .eq("id", application.id)
    .maybeSingle();
  assert.equal(otherAppView, null);

  await adminClient.from("applications").delete().eq("id", application.id);
  await adminClient.from("matches").delete().eq("id", match.id);
});
