import type { SupabaseClient } from "@supabase/supabase-js";
import { type GetMyMatchesRow, type MatchStatus, type MatchWithJob, mapMatchRow } from "./types";

/** Fetches the caller's own surfaced matches for one status via get_my_matches (RLS-safe even if the underlying job has since gone non-active). */
export async function fetchMatchesByStatus(supabase: SupabaseClient, status: MatchStatus): Promise<MatchWithJob[]> {
  const { data, error } = await supabase.rpc("get_my_matches", { p_status: status });
  if (error) throw new Error(error.message);
  return ((data ?? []) as GetMyMatchesRow[]).map(mapMatchRow);
}

/** Surfaces any newly-eligible matches (quota-aware, idempotent) then returns the caller's pending-review matches. A no-op surface when the profile isn't currently matching-eligible. */
export async function surfaceAndFetchPendingMatches(supabase: SupabaseClient): Promise<MatchWithJob[]> {
  const { error: surfaceError } = await supabase.rpc("surface_new_matches_for_user");
  if (surfaceError) throw new Error(surfaceError.message);
  return fetchMatchesByStatus(supabase, "pending_review");
}
