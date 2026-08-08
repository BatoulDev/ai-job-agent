// Phase 10 — CV replacement/versioning, and CV-analysis review/confirmation.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  createTestUser,
  deleteTestUsers,
  uploadFakeCv,
  insertFakeAnalysis,
} from "./helpers.mjs";

let userA;
let userB;

before(async () => {
  await assertExpectedLocalProject();
  userA = await createTestUser("cv-a");
  userB = await createTestUser("cv-b");
});

after(async () => {
  await deleteTestUsers([userA, userB]);
});

test("first CV creation via replace_cv", async () => {
  const cv = await uploadFakeCv(userA, "first.pdf");
  assert.equal(cv.version, 1);
  assert.equal(cv.is_active, true);
});

test("replacing the CV creates a new active version and deactivates the old one", async () => {
  const first = await uploadFakeCv(userA, "second-a.pdf");
  const replaced = await uploadFakeCv(userA, "second-b.pdf");

  assert.notEqual(replaced.id, first.id);
  assert.equal(replaced.version, first.version + 1);
  assert.equal(replaced.is_active, true);

  const { data: oldRow } = await adminClient.from("cvs").select("is_active, superseded_at").eq("id", first.id).single();
  assert.equal(oldRow.is_active, false);
  assert.notEqual(oldRow.superseded_at, null);
});

test("only one active CV per user (DB invariant, not just app logic)", async () => {
  const { data: activeCvs } = await adminClient
    .from("cvs")
    .select("id")
    .eq("user_id", userA.id)
    .eq("is_active", true);
  assert.equal(activeCvs.length, 1);
});

test("historical CV versions remain queryable", async () => {
  const { data: allCvs } = await adminClient.from("cvs").select("id, version").eq("user_id", userA.id);
  assert.ok(allCvs.length >= 2);
});

test("concurrent replace_cv calls cannot both end up active (fails safely, no duplicate active rows)", async () => {
  const attempts = await Promise.allSettled([
    uploadFakeCv(userA, "race-1.pdf"),
    uploadFakeCv(userA, "race-2.pdf"),
    uploadFakeCv(userA, "race-3.pdf"),
  ]);
  // Row-locking in replace_cv() serializes these — all should succeed
  // (each sees the previous one's committed state), but there must still
  // be exactly one active row afterward regardless.
  const succeeded = attempts.filter((a) => a.status === "fulfilled");
  assert.ok(succeeded.length >= 1);

  const { data: activeCvs } = await adminClient
    .from("cvs")
    .select("id")
    .eq("user_id", userA.id)
    .eq("is_active", true);
  assert.equal(activeCvs.length, 1);
});

test("user cannot read another user's CV metadata", async () => {
  const { data, error } = await userB.client.from("cvs").select("id").eq("user_id", userA.id).maybeSingle();
  assert.equal(error, null);
  assert.equal(data, null);
});

test("user cannot directly insert/update cvs rows (must go through replace_cv)", async () => {
  const { error: insertError } = await userA.client.from("cvs").insert({
    user_id: userA.id,
    storage_path: `${userA.id}/direct-insert.pdf`,
    file_name: "direct-insert.pdf",
    file_size_bytes: 100,
    mime_type: "application/pdf",
  });
  assert.notEqual(insertError, null);

  const { data: someCv } = await adminClient.from("cvs").select("id").eq("user_id", userA.id).limit(1).single();
  const { error: updateError } = await userA.client.from("cvs").update({ is_active: false }).eq("id", someCv.id);
  assert.notEqual(updateError, null);
});

// --- CV analysis review/confirmation ---

test("AI analysis begins unconfirmed (pending_review)", async () => {
  const cv = await uploadFakeCv(userB, "review-flow.pdf");
  const analysis = await insertFakeAnalysis(userB, cv.id);
  assert.equal(analysis.review_status, "pending_review");
  assert.equal(analysis.is_current, false);
});

test("owner can save review edits; non-owner cannot", async () => {
  const cv = await uploadFakeCv(userA, "review-edit.pdf");
  const analysis = await insertFakeAnalysis(userA, cv.id);

  const { data: updated, error } = await userA.client.rpc("update_cv_analysis_review", {
    p_analysis_id: analysis.id,
    p_user_edits: { professional_summary: "Edited by owner" },
  });
  assert.equal(error, null);
  assert.equal(updated.review_status, "changes_requested");

  const { error: otherError } = await userB.client.rpc("update_cv_analysis_review", {
    p_analysis_id: analysis.id,
    p_user_edits: { professional_summary: "Hacked" },
  });
  assert.notEqual(otherError, null);
});

test("owner can confirm a valid reviewed analysis; matching-eligible query returns only confirmed data", async () => {
  const { data: preConfirm } = await adminClient
    .from("cv_analyses")
    .select("id")
    .eq("user_id", userA.id)
    .eq("review_status", "approved");
  assert.equal(preConfirm.length, 0);

  const { data: analyses } = await adminClient
    .from("cv_analyses")
    .select("id")
    .eq("user_id", userA.id)
    .eq("review_status", "changes_requested")
    .limit(1);
  const analysisId = analyses[0].id;

  const { data: confirmed, error } = await userA.client.rpc("confirm_cv_analysis", { p_analysis_id: analysisId });
  assert.equal(error, null);
  assert.equal(confirmed.review_status, "approved");
  assert.equal(confirmed.is_current, true);
  assert.notEqual(confirmed.approved_at, null);

  // The eligible-for-matching query: exactly one approved + current row.
  const { data: eligible } = await adminClient
    .from("cv_analyses")
    .select("id")
    .eq("user_id", userA.id)
    .eq("review_status", "approved")
    .eq("is_current", true);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].id, analysisId);
});

test("confirmation is idempotent", async () => {
  const { data: approved } = await adminClient
    .from("cv_analyses")
    .select("id")
    .eq("user_id", userA.id)
    .eq("review_status", "approved")
    .single();

  const { data: second, error } = await userA.client.rpc("confirm_cv_analysis", { p_analysis_id: approved.id });
  assert.equal(error, null);
  assert.equal(second.review_status, "approved");
});

test("invalid transition rejected: cannot edit an already-approved analysis", async () => {
  const { data: approved } = await adminClient
    .from("cv_analyses")
    .select("id")
    .eq("user_id", userA.id)
    .eq("review_status", "approved")
    .single();

  const { error: editError } = await userA.client.rpc("update_cv_analysis_review", {
    p_analysis_id: approved.id,
    p_user_edits: { professional_summary: "Too late" },
  });
  assert.notEqual(editError, null);
});

test("a newly replaced CV does not silently keep an old analysis as confirmed for the new CV", async () => {
  // userA already has an approved+current analysis (prior tests). Replacing
  // their CV must supersede it — the trigger added in
  // 20260809090100_add_cv_analyses_review_confirm.sql.
  const { data: before } = await adminClient
    .from("cv_analyses")
    .select("id")
    .eq("user_id", userA.id)
    .eq("is_current", true)
    .single();

  await uploadFakeCv(userA, "post-approval-replacement.pdf");

  const { data: afterRow } = await adminClient
    .from("cv_analyses")
    .select("review_status, is_current, recommendations_state")
    .eq("id", before.id)
    .single();
  assert.equal(afterRow.is_current, false);
  assert.equal(afterRow.recommendations_state, "superseded");
  assert.equal(afterRow.review_status, "superseded");

  const { data: stillApprovedCount } = await adminClient
    .from("cv_analyses")
    .select("id")
    .eq("user_id", userA.id)
    .eq("review_status", "approved");
  assert.equal(stillApprovedCount.length, 0);
});

test("invalid transition rejected: cannot confirm a superseded analysis", async () => {
  const { data: superseded } = await adminClient
    .from("cv_analyses")
    .select("id")
    .eq("user_id", userA.id)
    .eq("recommendations_state", "superseded")
    .limit(1)
    .single();

  const { error } = await userA.client.rpc("confirm_cv_analysis", { p_analysis_id: superseded.id });
  assert.notEqual(error, null);
});
