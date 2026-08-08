// Phase 10 — Constraints, deletion behavior, and index verification.
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
const jobIdsToClean = [];

before(async () => {
  await assertExpectedLocalProject();
  userA = await createTestUser("constraints-a");
});

after(async () => {
  await deleteFakeJobs(jobIdsToClean);
  await deleteTestUsers([userA]);
});

test("foreign keys reject invalid references", async () => {
  const { error } = await adminClient.from("cv_analyses").insert({
    user_id: userA.id,
    cv_id: "00000000-0000-0000-0000-000000000000",
    status: "completed",
    preference_snapshot: {},
  });
  assert.notEqual(error, null);
});

test("important check constraints reject invalid states", async () => {
  const cv = await uploadFakeCv(userA, "constraint-check.pdf");
  const { error: badReview } = await adminClient.from("cv_analyses").insert({
    user_id: userA.id,
    cv_id: cv.id,
    status: "completed",
    review_status: "not_a_real_status",
    preference_snapshot: {},
  });
  assert.notEqual(badReview, null);

  const job = await insertFakeJob({ title: "Constraint check job" });
  jobIdsToClean.push(job.id);
  const { error: badScore } = await adminClient.from("matches").insert({
    user_id: userA.id,
    job_id: job.id,
    cv_analysis_id: (await insertFakeAnalysis(userA, cv.id)).id,
    score: 500,
  });
  assert.notEqual(badScore, null);
});

test("ownership fields cannot be reassigned by an ordinary client", async () => {
  const otherUser = await createTestUser("constraints-reassign-target");
  const cv = await uploadFakeCv(userA, "ownership-check.pdf");

  const { error } = await userA.client.from("cvs").update({ user_id: otherUser.id }).eq("id", cv.id);
  // Blocked at the grant layer (update grant no longer exists at all for
  // cvs — see 20260809090010) before ownership reassignment is even a
  // question.
  assert.notEqual(error, null);

  await deleteTestUsers([otherUser]);
});

test("deleting an account cascades DB rows cleanly (cvs, cv_analyses, matches, applications, notifications)", async () => {
  const deletionUser = await createTestUser("deletion-target");
  const cv = await uploadFakeCv(deletionUser, "deletion-fixture.pdf");
  const analysis = await insertFakeAnalysis(deletionUser, cv.id);
  const { data: confirmed } = await deletionUser.client.rpc("confirm_cv_analysis", { p_analysis_id: analysis.id });
  const job = await insertFakeJob({ title: "Deletion fixture job" });
  jobIdsToClean.push(job.id);
  const { data: match } = await adminClient
    .from("matches")
    .insert({ user_id: deletionUser.id, job_id: job.id, cv_analysis_id: confirmed.id, score: 60 })
    .select()
    .single();
  await adminClient.from("notifications").insert({ user_id: deletionUser.id, notification_type: "match_ready" });

  // Sanity: the storage object exists before deletion (uploaded via the
  // real client flow, exactly like a real user's CV).
  const { data: objectsBefore } = await adminClient.storage.from("cvs").list(deletionUser.id);
  assert.ok(objectsBefore.length >= 1);

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(deletionUser.id);
  assert.equal(deleteError, null);

  const { data: cvsAfter } = await adminClient.from("cvs").select("id").eq("user_id", deletionUser.id);
  const { data: analysesAfter } = await adminClient.from("cv_analyses").select("id").eq("user_id", deletionUser.id);
  const { data: matchesAfter } = await adminClient.from("matches").select("id").eq("id", match.id);
  const { data: notificationsAfter } = await adminClient
    .from("notifications")
    .select("id")
    .eq("user_id", deletionUser.id);
  assert.deepEqual(cvsAfter, []);
  assert.deepEqual(analysesAfter, []);
  assert.deepEqual(matchesAfter, []);
  assert.deepEqual(notificationsAfter, []);

  // KNOWN, PRE-EXISTING GAP (audit finding SEC-05, not resolved by this
  // mission — no account-deletion route or Storage-cleanup step exists
  // yet): the DB rows above cascade correctly, but the Storage object is
  // NOT automatically removed by auth.users deletion (Storage objects have
  // no FK to auth.users). This assertion documents current behavior
  // honestly rather than silently passing a false "fully cleaned up"
  // claim — the object is inert (no owner session can ever reach it
  // again, since the owning user no longer exists), but it is not
  // deleted. See the implementation report's "Remaining Security or
  // Product Risks" section.
  const { data: objectsAfter } = await adminClient.storage.from("cvs").list(deletionUser.id);
  assert.ok(
    objectsAfter.length >= 1,
    "Documents SEC-05: Storage cleanup on account deletion remains unimplemented, as reported by the original audit."
  );
  // Clean up the orphan ourselves so the test suite doesn't leak fixture data.
  if (objectsAfter.length > 0) {
    await adminClient.storage.from("cvs").remove(objectsAfter.map((o) => `${deletionUser.id}/${o.name}`));
  }
});

// Index existence/definition and EXPLAIN plans are verified separately via
// direct read-only `psql` introspection (pg_catalog/pg_indexes are not
// exposed through PostgREST, so they cannot be checked through this
// Supabase client) — see the implementation report's Query and Index
// Matrix section for that evidence.
