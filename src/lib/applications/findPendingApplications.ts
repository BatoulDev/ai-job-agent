import type { SupabaseClient } from "@supabase/supabase-js";

/** Every application waiting to actually be sent by email — external_link applications have nothing for this system to send automatically (the user clicks through themselves; see Phase 10's manual tracking). */
export async function findPendingEmailApplicationIds(supabase: SupabaseClient, limit: number): Promise<string[]> {
  const { data, error } = await supabase
    .from("applications")
    .select("id")
    .eq("status", "pending_send")
    .eq("application_method", "email")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`findPendingEmailApplicationIds: query failed: ${error.message}`);
  return (data ?? []).map((row) => row.id);
}
