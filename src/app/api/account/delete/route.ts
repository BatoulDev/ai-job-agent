import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteAccount } from "@/lib/account/deleteAccount";
import { decodeJwtIssuedAt, isSessionFresh } from "@/lib/account/sessionFreshness";

// POST /api/account/delete
//
// LOCALLY IMPLEMENTED AND TESTED — NOT YET PRODUCTION-DEPLOYED. Wired to
// /settings/delete-account per the founder-approved 2026-11-02 policy (see
// docs/ACCOUNT_DELETION_DESIGN.md): immediate deletion after reauthentication,
// no 30-day wait. The underlying cascade this calls is fully implemented and
// tested (tests/db/account-deletion-cascade.test.mjs,
// tests/unit/delete-account.test.mjs).
//
// Deletes only the caller's own account: userId comes from
// supabase.auth.getUser() (revalidated against Supabase Auth), never from
// the request body (AGENTS.md §28 — never accept a user id from the
// client as proof of identity). Requires an explicit literal confirmation
// string in the body as a defense against an accidental/CSRF-triggered call,
// AND a session re-issued within the last few minutes (AGENTS.md §28
// "sensitive account changes should require recent authentication") via
// either POST /api/account/reauthenticate (password accounts) or a fresh
// Google OAuth round-trip — see src/lib/account/sessionFreshness.ts.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const confirm =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>).confirm : null;
  if (confirm !== "DELETE") {
    return NextResponse.json({ error: 'Request body must include confirm: "DELETE".' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const issuedAt = session ? decodeJwtIssuedAt(session.access_token) : null;
  if (issuedAt === null || !isSessionFresh(issuedAt)) {
    return NextResponse.json(
      { error: "REAUTH_REQUIRED", message: "Please re-authenticate before deleting your account." },
      { status: 403 }
    );
  }

  const result = await deleteAccount(createAdminClient(), user.id);
  if (!result.ok) {
    console.error("deleteAccount failed:", result.step, result.message);
    return NextResponse.json(
      { error: "Could not fully delete your account. Please contact support." },
      { status: 500 }
    );
  }

  // Safe session termination (AGENTS.md §2F): the account is already gone,
  // so this just clears this response's auth cookies rather than leaving a
  // token that would fail on its next use.
  await supabase.auth.signOut();

  return NextResponse.json({ ok: true });
}
