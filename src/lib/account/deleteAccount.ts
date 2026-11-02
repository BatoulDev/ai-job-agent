import type { SupabaseClient } from "@supabase/supabase-js";

export interface DeleteAccountResult {
  ok: boolean;
  step?: "auth" | "storage";
  message?: string;
}

async function retryWithBackoff<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 300): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

// Production account-deletion sequence (BLOCKED_PENDING_APPROVAL for live
// activation — see docs/ACCOUNT_DELETION_DESIGN.md). Must be called with
// the CALLER'S OWN user id only (never a client-supplied id) after the
// caller is already authenticated — enforced by src/app/api/account/delete
// /route.ts, not here.
//
// Order is deliberate and empirically proven by
// tests/db/account-deletion-cascade.test.mjs's Storage-lifecycle finding:
// adminClient.auth.admin.deleteUser() cascades every DB-owned row (`on
// delete cascade` from auth.users, see that migration's own FK audit) but
// never touches Storage. So the auth/DB deletion happens FIRST — this
// never leaves an active-looking account half-deleted — then Storage
// cleanup second, as an idempotent, retryable step scoped to exactly that
// user's own "{uid}/..." folder (mirrors tests/db/fixtureCleanup.mjs's
// removeStorageForUser, in the opposite order, for the same reason that
// file documents).
export async function deleteAccount(adminClient: SupabaseClient, userId: string): Promise<DeleteAccountResult> {
  try {
    await retryWithBackoff(async () => {
      const { error } = await adminClient.auth.admin.deleteUser(userId);
      if (error && !/not.?found/i.test(error.message ?? "")) {
        throw new Error(error.message);
      }
    });
  } catch (err) {
    return { ok: false, step: "auth", message: err instanceof Error ? err.message : String(err) };
  }

  try {
    await retryWithBackoff(async () => {
      const { data: objects, error: listError } = await adminClient.storage.from("cvs").list(userId);
      if (listError) throw new Error(listError.message);
      if (objects && objects.length > 0) {
        const { error: removeError } = await adminClient.storage
          .from("cvs")
          .remove(objects.map((o) => `${userId}/${o.name}`));
        if (removeError) throw new Error(removeError.message);
      }
    });
  } catch (err) {
    return { ok: false, step: "storage", message: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true };
}
