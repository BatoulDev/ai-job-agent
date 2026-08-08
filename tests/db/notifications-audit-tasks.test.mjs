// Phase 10 — Notifications, audit events, automation tasks.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject, createTestUser, deleteTestUsers } from "./helpers.mjs";

let userA;
let userB;

before(async () => {
  await assertExpectedLocalProject();
  userA = await createTestUser("notif-a");
  userB = await createTestUser("notif-b");
});

after(async () => {
  await deleteTestUsers([userA, userB]);
});

test("users see only their own notifications", async () => {
  const { data: notification } = await adminClient
    .from("notifications")
    .insert({ user_id: userA.id, notification_type: "match_ready" })
    .select()
    .single();

  const { data: ownView } = await userA.client.from("notifications").select("id").eq("id", notification.id).maybeSingle();
  assert.notEqual(ownView, null);

  const { data: otherView } = await userB.client.from("notifications").select("id").eq("id", notification.id).maybeSingle();
  assert.equal(otherView, null);

  const { data: markedRead, error } = await userA.client.rpc("mark_notification_read", {
    p_notification_id: notification.id,
  });
  assert.equal(error, null);
  assert.equal(markedRead.status, "read");

  const { error: crossUserError } = await userB.client.rpc("mark_notification_read", {
    p_notification_id: notification.id,
  });
  assert.notEqual(crossUserError, null);

  await adminClient.from("notifications").delete().eq("id", notification.id);
});

test("ordinary users cannot forge trusted audit history", async () => {
  const { error: insertError } = await userA.client.from("audit_events").insert({
    user_id: userA.id,
    actor_type: "user",
    event_type: "match_approved",
    entity_type: "match",
    entity_id: userA.id, // arbitrary uuid, content doesn't matter — insert itself must fail
  });
  assert.notEqual(insertError, null);
});

test("ordinary users can read their own audit events but not another user's", async () => {
  const { data: event } = await adminClient
    .from("audit_events")
    .insert({ user_id: userA.id, actor_type: "system", event_type: "cv_analysis_confirmed" })
    .select()
    .single();

  const { data: ownView } = await userA.client.from("audit_events").select("id").eq("id", event.id).maybeSingle();
  assert.notEqual(ownView, null);

  const { data: otherView } = await userB.client.from("audit_events").select("id").eq("id", event.id).maybeSingle();
  assert.equal(otherView, null);
});

test("real approval RPCs write a corresponding audit event", async () => {
  // confirm_cv_analysis is exercised end-to-end in cv-versioning-and-review.test.mjs;
  // here we only check the audit side-effect contract using a lightweight
  // direct scenario: approve_match must leave an audit_events row behind.
  const job = await adminClient
    .from("jobs")
    .insert({
      title: "Audit fixture job",
      company_name: "Test Co",
      description: "x",
      application_method: "external_link",
      application_url: "https://example.test",
      source_type: "admin_manual",
    })
    .select()
    .single();

  const cvUpload = await userA.client.storage
    .from("cvs")
    .upload(`${userA.id}/audit-fixture.pdf`, new TextEncoder().encode("%PDF-1.4 fixture\n"), {
      contentType: "application/pdf",
    });
  assert.equal(cvUpload.error, null);
  const { data: cv } = await userA.client.rpc("replace_cv", {
    p_storage_path: cvUpload.data.path,
    p_file_name: "audit-fixture.pdf",
    p_file_size_bytes: 30,
    p_mime_type: "application/pdf",
  });

  const { data: analysis } = await adminClient
    .from("cv_analyses")
    .insert({ user_id: userA.id, cv_id: cv.id, status: "completed", preference_snapshot: {} })
    .select()
    .single();
  const { data: confirmed } = await userA.client.rpc("confirm_cv_analysis", { p_analysis_id: analysis.id });

  const { data: match } = await adminClient
    .from("matches")
    .insert({ user_id: userA.id, job_id: job.data.id, cv_analysis_id: confirmed.id, score: 75 })
    .select()
    .single();
  await userA.client.rpc("approve_match", { p_match_id: match.id });

  const { data: events } = await adminClient
    .from("audit_events")
    .select("event_type")
    .eq("entity_id", match.id)
    .eq("event_type", "match_approved");
  assert.equal(events.length, 1);

  await adminClient.from("matches").delete().eq("id", match.id);
  await adminClient.from("jobs").delete().eq("id", job.data.id);
});

test("automation_tasks: duplicate idempotency key rejected; ordinary users cannot claim or view tasks", async () => {
  const key = `test-automation-task-${userA.id}`;
  const { error: firstError } = await adminClient.from("automation_tasks").insert({
    task_type: "job_matching",
    subject_type: "match",
    subject_id: userA.id,
    idempotency_key: key,
  });
  assert.equal(firstError, null);

  const { error: dupError } = await adminClient.from("automation_tasks").insert({
    task_type: "job_matching",
    subject_type: "match",
    subject_id: userA.id,
    idempotency_key: key,
  });
  assert.notEqual(dupError, null);

  const { data: userView, error: userError } = await userA.client.from("automation_tasks").select("id");
  // No grant at all for authenticated -> PostgREST rejects the request outright.
  assert.notEqual(userError, null);
  assert.equal(userView, null);

  await adminClient.from("automation_tasks").delete().eq("idempotency_key", key);
});

test("automation_tasks: one active task per (subject, task_type); pending lookup and retry scheduling behave correctly", async () => {
  const subjectId = userB.id;
  const { data: pending } = await adminClient
    .from("automation_tasks")
    .insert({
      task_type: "cover_letter_generation",
      subject_type: "cover_letter",
      subject_id: subjectId,
      idempotency_key: `test-pending-${subjectId}`,
    })
    .select()
    .single();

  const { error: dupActiveError } = await adminClient.from("automation_tasks").insert({
    task_type: "cover_letter_generation",
    subject_type: "cover_letter",
    subject_id: subjectId,
    idempotency_key: `test-pending-2-${subjectId}`,
  });
  assert.notEqual(dupActiveError, null);

  const { data: claimable } = await adminClient
    .from("automation_tasks")
    .select("id")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .eq("id", pending.id);
  assert.equal(claimable.length, 1);

  // Simulate a failed attempt scheduled for retry.
  const retryAt = new Date(Date.now() + 60_000).toISOString();
  const { data: failed, error } = await adminClient
    .from("automation_tasks")
    .update({ status: "failed", attempt_count: 1, last_error: "simulated failure", next_attempt_at: retryAt })
    .eq("id", pending.id)
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(failed.status, "failed");

  // Now that the previous one is terminal (failed), a fresh task for the
  // same subject/type is allowed again — retry-via-new-row.
  const { error: newTaskError } = await adminClient.from("automation_tasks").insert({
    task_type: "cover_letter_generation",
    subject_type: "cover_letter",
    subject_id: subjectId,
    idempotency_key: `test-retry-${subjectId}`,
  });
  assert.equal(newTaskError, null);

  await adminClient.from("automation_tasks").delete().eq("subject_id", subjectId);
});
