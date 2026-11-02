// Unit tests for src/lib/account/deleteAccount.ts using a hand-built fake
// Supabase client (no DB, no network) — the real end-to-end cascade is
// already proven by tests/db/account-deletion-cascade.test.mjs; this file
// only proves this specific wrapper's own logic: call order, "not found"
// treated as success, retry-then-fail reporting, and per-step error shape.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deleteAccount } from "../../src/lib/account/deleteAccount.ts";

function fakeClient({ deleteUserError = null, listResult = { data: [], error: null }, removeError = null, deleteUserCalls = [] } = {}) {
  return {
    auth: {
      admin: {
        deleteUser: async (id) => {
          deleteUserCalls.push(id);
          return { error: deleteUserError };
        },
      },
    },
    storage: {
      from: () => ({
        list: async () => listResult,
        remove: async () => ({ error: removeError }),
      }),
    },
  };
}

describe("deleteAccount", () => {
  test("succeeds when auth deletion and an empty storage folder both succeed", async () => {
    const client = fakeClient();
    const result = await deleteAccount(client, "user-1");
    assert.deepEqual(result, { ok: true });
  });

  test("deletes auth user before listing/removing storage (order matters per the Storage-lifecycle finding)", async () => {
    const callOrder = [];
    const client = {
      auth: { admin: { deleteUser: async () => { callOrder.push("auth"); return { error: null }; } } },
      storage: { from: () => ({ list: async () => { callOrder.push("storage-list"); return { data: [], error: null }; }, remove: async () => ({ error: null }) }) },
    };
    await deleteAccount(client, "user-1");
    assert.deepEqual(callOrder, ["auth", "storage-list"]);
  });

  test("treats a 'not found' auth error as success (idempotent repeat call)", async () => {
    const client = fakeClient({ deleteUserError: { message: "User not found" } });
    const result = await deleteAccount(client, "user-1");
    assert.deepEqual(result, { ok: true });
  });

  test("removes every listed storage object, scoped to this user's own folder", async () => {
    const removedPaths = [];
    const client = {
      auth: { admin: { deleteUser: async () => ({ error: null }) } },
      storage: {
        from: () => ({
          list: async () => ({ data: [{ name: "a.pdf" }, { name: "b.pdf" }], error: null }),
          remove: async (paths) => { removedPaths.push(...paths); return { error: null }; },
        }),
      },
    };
    const result = await deleteAccount(client, "user-42");
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(removedPaths, ["user-42/a.pdf", "user-42/b.pdf"]);
  });

  test("reports step: 'auth' and never attempts storage when auth deletion fails for a real reason", async () => {
    let storageCalled = false;
    const client = {
      auth: { admin: { deleteUser: async () => ({ error: { message: "network error" } }) } },
      storage: { from: () => ({ list: async () => { storageCalled = true; return { data: [], error: null }; }, remove: async () => ({ error: null }) }) },
    };
    const result = await deleteAccount(client, "user-1");
    assert.equal(result.ok, false);
    assert.equal(result.step, "auth");
    assert.equal(storageCalled, false, "must not attempt storage cleanup once auth deletion has failed for a real reason");
  });

  test("reports step: 'storage' when the auth user is gone but storage cleanup fails", async () => {
    const client = fakeClient({ listResult: { data: null, error: { message: "storage unavailable" } } });
    const result = await deleteAccount(client, "user-1");
    assert.equal(result.ok, false);
    assert.equal(result.step, "storage");
  });

  test("retries a transient failure and succeeds on a later attempt", async () => {
    let attempts = 0;
    const client = {
      auth: {
        admin: {
          deleteUser: async () => {
            attempts++;
            if (attempts < 2) return { error: { message: "temporary GoTrue error" } };
            return { error: null };
          },
        },
      },
      storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ error: null }) }) },
    };
    const result = await deleteAccount(client, "user-1");
    assert.deepEqual(result, { ok: true });
    assert.equal(attempts, 2);
  });
});
