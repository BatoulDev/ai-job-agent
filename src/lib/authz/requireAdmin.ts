import { createClient } from "@/lib/supabase/server";

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "NotAuthenticatedError";
  }
}

export class NotAdminError extends Error {
  constructor() {
    super("Admin privileges required");
    this.name = "NotAdminError";
  }
}

// Reusable server-side admin authorization check for future admin routes
// (job ingestion, etc. — none exist yet in this phase). Re-derives the
// user from the session (never trusts a client-supplied role or user id)
// and checks admin status via the public.is_admin() database function,
// which itself reads only the calling session's own profiles.role under
// RLS (see supabase/migrations/20260809090020_add_profiles_role.sql) — the
// authoritative source of truth, not a client-supplied flag or a
// frontend-only check. Throws rather than returning a boolean so a caller
// can never accidentally treat a rejected check as authorized.
export async function requireAdmin(): Promise<{ userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new NotAuthenticatedError();
  }

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError) {
    throw new Error(`Failed to verify admin status: ${adminError.message}`);
  }
  if (!isAdmin) {
    throw new NotAdminError();
  }

  return { userId: user.id };
}
