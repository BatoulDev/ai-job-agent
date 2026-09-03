// Regression coverage for the Automation-1 audit's headline finding:
// confirm_cv_analysis() never checked recommendations_state='current' or
// compared preferences_version to the live job_preferences.version, so a
// stale analysis (preferences changed after the analysis was generated or
// approved) could be approved — or re-approved — unchanged. Reproduced live
// during the audit against a real fixture user before being fixed here.
//
// Fixed by:
//   supabase/migrations/20260825100000_harden_confirm_cv_analysis_freshness.sql
//   supabase/migrations/20260825100010_add_matching_eligibility_gate.sql
//   supabase/migrations/20260825100030_demote_analysis_on_feedback.sql
//
// Covers audit §5 Backend Scenarios 1 and 3, and §11's "missing tests" list:
//   - stale-preferences analysis cannot be approved
//   - a stale-but-approved analysis cannot back a new matches insert
//   - a rapid preference-version race (V1 -> V2 -> V3) leaves the V2-based
//     analysis permanently unconfirmable once V3 is live
//   - feedback submitted against an approved/current analysis demotes it
//
// Run: node --test tests/db/confirm-analysis-freshness.test.mjs
// (requires a running local Supabase project with all migrations applied)

import { test, describe, before, after } from "node:test";
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
  userA = await createTestUser("freshness-a");
  userB = await createTestUser("freshness-b");
});

after(async () => {
  await deleteTestUsers([userA, userB]);
});

async function savePrefs(userClient, overrides = {}) {
  const defaults = {
    p_work_arrangement: "remote",
    p_job_market_coverage: null,
    p_job_type: "full-time",
    p_experience_level: "entry-level",
    p_additional_notes: null,
    p_custom_target_roles: [],
    p_custom_locations: [],
    p_target_role_ids: [],
    p_location_ids: [],
    p_lebanon_location_scope: "selected_only",
  };
  const { error } = await userClient.rpc("save_job_preferences", { ...defaults, ...overrides });
  assert.equal(error, null, `save_job_preferences failed: ${error?.message}`);
}

async function getPrefsVersion(userId) {
  const { data, error } = await adminClient
    .from("job_preferences")
    .select("version")
    .eq("user_id", userId)
    .single();
  assert.equal(error, null, `getPrefsVersion error: ${error?.message}`);
  return data.version;
}

async function getAnalysisRow(id) {
  const { data, error } = await adminClient
    .from("cv_analyses")
    .select("*")
    .eq("id", id)
    .single();
  assert.equal(error, null, `getAnalysisRow error: ${error?.message}`);
  return data;
}

// cv_analyses_one_approved_per_user allows at most one review_status='approved'
// row per user at a time. Tests below share userA/userB across `describe`
// blocks and some insert review_status='approved' directly (bypassing
// confirm_cv_analysis's own atomic supersession, which only demotes rows
// when approving *through the RPC*) — call this first so a raw insert never
// races the unique index against a prior test's leftover approved row.
async function demoteAnyExistingApproved(userId) {
  const { error } = await adminClient
    .from("cv_analyses")
    .update({ review_status: "superseded" })
    .eq("user_id", userId)
    .eq("review_status", "approved");
  assert.equal(error, null, `demoteAnyExistingApproved error: ${error?.message}`);
}

describe("confirm_cv_analysis: preference-freshness gate (Scenario 1)", () => {
  test("a completed analysis referencing an outdated preferences_version cannot be approved", async () => {
    const cv = await uploadFakeCv(userA, "freshness-v1.pdf");
    await savePrefs(userA.client, { p_job_type: "full-time" });
    const v1 = await getPrefsVersion(userA.id);

    const analysis = await insertFakeAnalysis(userA, cv.id, {
      status: "completed",
      review_status: "pending_review",
      is_current: false,
      recommendations_state: "current",
      preferences_version: v1,
    });

    // A genuine, detected preference change bumps the version.
    await savePrefs(userA.client, { p_job_type: "internship" });
    const v2 = await getPrefsVersion(userA.id);
    assert.notEqual(v2, v1, "preferences_version must have changed for this test to be meaningful");

    const { error: confirmError } = await userA.client.rpc("confirm_cv_analysis", {
      p_analysis_id: analysis.id,
    });
    assert.notEqual(confirmError, null, "confirm_cv_analysis must reject a V1-preferences analysis once preferences are V2");

    const row = await getAnalysisRow(analysis.id);
    assert.equal(row.review_status, "pending_review");
    assert.equal(row.is_current, false);
  });

  test("re-confirming an approved analysis that has since gone stale is rejected, not silently re-approved", async () => {
    const cv = await uploadFakeCv(userA, "freshness-reconfirm.pdf");
    await savePrefs(userA.client, { p_job_type: "full-time" });
    const v1 = await getPrefsVersion(userA.id);

    const analysis = await insertFakeAnalysis(userA, cv.id, {
      status: "completed",
      review_status: "pending_review",
      is_current: false,
      recommendations_state: "current",
      preferences_version: v1,
    });

    const { data: confirmed, error: firstConfirmError } = await userA.client.rpc("confirm_cv_analysis", {
      p_analysis_id: analysis.id,
    });
    assert.equal(firstConfirmError, null, `first confirm should succeed: ${firstConfirmError?.message}`);
    assert.equal(confirmed.review_status, "approved");
    assert.equal(confirmed.is_current, true);
    const approvedAt = confirmed.approved_at;
    assert.notEqual(approvedAt, null);

    // Preferences change after approval -> the staleness trigger demotes
    // recommendations_state but must NOT clear review_status/is_current
    // (existing, unchanged behavior — see 20260805090030...sql).
    await savePrefs(userA.client, { p_job_type: "internship" });

    const staleRow = await getAnalysisRow(analysis.id);
    assert.equal(staleRow.recommendations_state, "stale");
    assert.equal(staleRow.review_status, "approved", "review_status must stay approved (permanent historical record)");
    assert.equal(staleRow.is_current, true, "is_current must stay true until a refreshed analysis is approved");

    // The bug this test guards against: re-calling confirm_cv_analysis on
    // this same, now-stale row must be rejected — not treated as an
    // idempotent no-op that silently resets recommendations_state back to
    // 'current' with no new analysis ever having run.
    const { error: reconfirmError } = await userA.client.rpc("confirm_cv_analysis", {
      p_analysis_id: analysis.id,
    });
    assert.notEqual(reconfirmError, null, "re-confirming a stale-but-approved analysis must be rejected");

    const rowAfter = await getAnalysisRow(analysis.id);
    assert.equal(rowAfter.recommendations_state, "stale", "recommendations_state must remain stale, not silently reset to current");
    assert.equal(rowAfter.approved_at, approvedAt, "approved_at must be unchanged — history is preserved, not rewritten");
  });
});

describe("is_cv_analysis_matching_eligible / matches insert: stale analyses are rejected (Scenario 8)", () => {
  test("a stale-but-approved analysis cannot back a new matches row", async () => {
    const cv = await uploadFakeCv(userA, "freshness-match.pdf");
    await savePrefs(userA.client, { p_job_type: "full-time" });
    const v1 = await getPrefsVersion(userA.id);

    const analysis = await insertFakeAnalysis(userA, cv.id, {
      status: "completed",
      review_status: "pending_review",
      is_current: false,
      recommendations_state: "current",
      preferences_version: v1,
    });

    const { error: confirmError } = await userA.client.rpc("confirm_cv_analysis", { p_analysis_id: analysis.id });
    assert.equal(confirmError, null, `confirm should succeed: ${confirmError?.message}`);

    const { data: eligibleBefore, error: eligibleBeforeError } = await adminClient.rpc(
      "is_cv_analysis_matching_eligible",
      { p_analysis_id: analysis.id }
    );
    assert.equal(eligibleBeforeError, null);
    assert.equal(eligibleBefore, true, "a freshly approved, current analysis must be matching-eligible");

    await savePrefs(userA.client, { p_job_type: "internship" });

    const { data: eligibleAfter, error: eligibleAfterError } = await adminClient.rpc(
      "is_cv_analysis_matching_eligible",
      { p_analysis_id: analysis.id }
    );
    assert.equal(eligibleAfterError, null);
    assert.equal(eligibleAfter, false, "a stale-but-approved analysis must no longer be matching-eligible");

    const { data: job } = await adminClient
      .from("jobs")
      .insert({
        title: "Freshness fixture job",
        company_name: "Test Co",
        description: "x",
        application_method: "external_link",
        application_url: "https://example.test",
        source_type: "admin_manual",
      })
      .select()
      .single();

    const { error: matchError } = await adminClient
      .from("matches")
      .insert({ user_id: userA.id, job_id: job.id, cv_analysis_id: analysis.id, score: 80 });

    assert.notEqual(matchError, null, "matches insert must be rejected for a stale-but-approved analysis");

    await adminClient.from("jobs").delete().eq("id", job.id);
  });

  test("is_cv_analysis_matching_eligible rejects each individual freshness dimension", async () => {
    const cv = await uploadFakeCv(userB, "freshness-dims.pdf");
    await savePrefs(userB.client, { p_job_type: "full-time" });
    const v1 = await getPrefsVersion(userB.id);

    // Not completed.
    const processing = await insertFakeAnalysis(userB, cv.id, {
      status: "processing",
      review_status: "pending_review",
      is_current: false,
      recommendations_state: "current",
      preferences_version: v1,
    });
    const { data: e1 } = await adminClient.rpc("is_cv_analysis_matching_eligible", { p_analysis_id: processing.id });
    assert.equal(e1, false, "processing analysis must not be eligible");

    // Not approved.
    const pendingReview = await insertFakeAnalysis(userB, cv.id, {
      status: "completed",
      review_status: "pending_review",
      is_current: false,
      recommendations_state: "current",
      preferences_version: v1,
    });
    const { data: e2 } = await adminClient.rpc("is_cv_analysis_matching_eligible", { p_analysis_id: pendingReview.id });
    assert.equal(e2, false, "pending_review analysis must not be eligible");

    // Null preferences_version.
    await demoteAnyExistingApproved(userB.id);
    const nullVersion = await insertFakeAnalysis(userB, cv.id, {
      status: "completed",
      review_status: "approved",
      is_current: false,
      recommendations_state: "current",
      preferences_version: null,
      approved_at: new Date().toISOString(),
    });
    const { data: e3 } = await adminClient.rpc("is_cv_analysis_matching_eligible", { p_analysis_id: nullVersion.id });
    assert.equal(e3, false, "null preferences_version must not be eligible");

    // Mismatched preferences_version.
    await demoteAnyExistingApproved(userB.id);
    const mismatchedVersion = await insertFakeAnalysis(userB, cv.id, {
      status: "completed",
      review_status: "approved",
      is_current: false,
      recommendations_state: "current",
      preferences_version: v1 + 1000,
      approved_at: new Date().toISOString(),
    });
    const { data: e4 } = await adminClient.rpc("is_cv_analysis_matching_eligible", { p_analysis_id: mismatchedVersion.id });
    assert.equal(e4, false, "mismatched preferences_version must not be eligible");
  });
});

describe("rapid preference-version race: V1 -> V2 -> V3 (Scenario 3)", () => {
  test("an analysis snapshotted at V2 can never be approved once preferences have moved to V3", async () => {
    const cv = await uploadFakeCv(userA, "freshness-race.pdf");

    await savePrefs(userA.client, { p_job_type: "full-time" });
    // (V1 established above)

    await savePrefs(userA.client, { p_job_type: "internship" });
    const v2 = await getPrefsVersion(userA.id);

    // Simulates a task that was claimed while preferences were at V2 and
    // whose worker completes only after a further save (V3) has already
    // landed — the analysis it produces is snapshotted at V2.
    const lateAnalysis = await insertFakeAnalysis(userA, cv.id, {
      status: "completed",
      review_status: "pending_review",
      is_current: false,
      recommendations_state: "current",
      preferences_version: v2,
    });

    await savePrefs(userA.client, { p_job_type: "open" });
    const v3 = await getPrefsVersion(userA.id);
    assert.notEqual(v3, v2);

    const { error: confirmError } = await userA.client.rpc("confirm_cv_analysis", {
      p_analysis_id: lateAnalysis.id,
    });
    assert.notEqual(confirmError, null, "a V2-snapshotted analysis must be rejected once live preferences are V3");

    const { data: eligible } = await adminClient.rpc("is_cv_analysis_matching_eligible", {
      p_analysis_id: lateAnalysis.id,
    });
    assert.equal(eligible, false, "the V2-snapshotted analysis must never be matching-eligible once V3 is live");
  });
});

describe("submit_analysis_feedback demotes an approved/current analysis (Phase 6)", () => {
  test("recommendation_feedback against an approved, current analysis marks it stale without clearing approval history", async () => {
    const cv = await uploadFakeCv(userA, "freshness-feedback.pdf");
    await savePrefs(userA.client, { p_job_type: "full-time" });
    const v1 = await getPrefsVersion(userA.id);

    const analysis = await insertFakeAnalysis(userA, cv.id, {
      status: "completed",
      review_status: "pending_review",
      is_current: false,
      recommendations_state: "current",
      preferences_version: v1,
    });

    const { data: confirmed, error: confirmError } = await userA.client.rpc("confirm_cv_analysis", {
      p_analysis_id: analysis.id,
    });
    assert.equal(confirmError, null, `confirm should succeed: ${confirmError?.message}`);
    const approvedAt = confirmed.approved_at;

    const { data: feedback, error: feedbackError } = await userA.client.rpc("submit_analysis_feedback", {
      p_analysis_id: analysis.id,
      p_feedback_type: "recommendation_feedback",
      p_feedback_text: "Please recommend more backend-focused roles.",
      p_affected_section: null,
    });
    assert.equal(feedbackError, null, `submit_analysis_feedback should succeed: ${feedbackError?.message}`);
    assert.equal(feedback.feedback_type, "recommendation_feedback");

    const rowAfterFeedback = await getAnalysisRow(analysis.id);
    assert.equal(rowAfterFeedback.recommendations_state, "stale", "feedback against a current, approved analysis must demote it to stale");
    assert.equal(rowAfterFeedback.review_status, "approved", "review_status must stay approved (permanent historical record)");
    assert.equal(rowAfterFeedback.approved_at, approvedAt, "approved_at must be preserved, not cleared");
    assert.equal(rowAfterFeedback.is_current, true, "is_current must stay true (same convention as preference-triggered staleness)");

    const { data: eligible } = await adminClient.rpc("is_cv_analysis_matching_eligible", { p_analysis_id: analysis.id });
    assert.equal(eligible, false, "the demoted analysis must no longer be matching-eligible");

    const { error: reconfirmError } = await userA.client.rpc("confirm_cv_analysis", { p_analysis_id: analysis.id });
    assert.notEqual(reconfirmError, null, "the demoted analysis cannot be re-confirmed as-is");
  });

  test("feedback against a non-current (already superseded) analysis does not regress its state", async () => {
    const cv = await uploadFakeCv(userA, "freshness-feedback-superseded.pdf");
    await savePrefs(userA.client, { p_job_type: "full-time" });
    const v1 = await getPrefsVersion(userA.id);

    await demoteAnyExistingApproved(userA.id);
    const analysis = await insertFakeAnalysis(userA, cv.id, {
      status: "completed",
      review_status: "approved",
      is_current: false,
      recommendations_state: "superseded",
      approved_at: new Date().toISOString(),
      preferences_version: v1,
    });

    const { error: feedbackError } = await userA.client.rpc("submit_analysis_feedback", {
      p_analysis_id: analysis.id,
      p_feedback_type: "user_request",
      p_feedback_text: "This is now historical, just checking it doesn't regress.",
      p_affected_section: null,
    });
    assert.equal(feedbackError, null, `submit_analysis_feedback should succeed: ${feedbackError?.message}`);

    const row = await getAnalysisRow(analysis.id);
    assert.equal(row.recommendations_state, "superseded", "an already-superseded row must never regress to stale");
  });
});
