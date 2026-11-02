// tests/db/delete-account-route-logic.test.mjs
//
// Focused integration test for src/lib/account/deleteAccount.ts — the
// production wrapper behind the (not-yet-UI-linked) POST
// /api/account/delete route. The deep cascade correctness across every
// personal-data table is already exhaustively proven by
// tests/db/account-deletion-cascade.test.mjs calling
// adminClient.auth.admin.deleteUser() directly; this file only proves the
// production wrapper itself performs that same proven sequence correctly
// against one representative real fixture (CV + preferences), end to end,
// against the real guarded local database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject, createTestUser, uploadFakeCv } from "./helpers.mjs";
import { deleteAccount } from "../../src/lib/account/deleteAccount.ts";

describe("deleteAccount (production wrapper) against the real local database", () => {
  test("deletes the auth user, cascades DB rows, and cleans up the Storage folder", async () => {
    await assertExpectedLocalProject();

    const user = await createTestUser("del-wrapper");
    const cv = await uploadFakeCv(user, "wrapper.pdf");

    const { data: storageBefore } = await adminClient.storage.from("cvs").list(user.id);
    assert.ok(storageBefore && storageBefore.length >= 1, "fixture CV must exist in storage before deletion");

    const result = await deleteAccount(adminClient, user.id);
    assert.deepEqual(result, { ok: true });

    const { data: authUser } = await adminClient.auth.admin.getUserById(user.id);
    assert.equal(authUser?.user ?? null, null, "auth user must be gone");

    const { data: cvRow } = await adminClient.from("cvs").select("id").eq("id", cv.id).maybeSingle();
    assert.equal(cvRow, null, "cvs row must be gone (DB cascade)");

    const { data: storageAfter } = await adminClient.storage.from("cvs").list(user.id);
    assert.ok(!storageAfter || storageAfter.length === 0, "storage folder must be cleaned up by the wrapper itself");

    // Idempotent repeat call (e.g. a retried client request) must not throw
    // or report failure.
    const repeat = await deleteAccount(adminClient, user.id);
    assert.deepEqual(repeat, { ok: true });
  });
});
