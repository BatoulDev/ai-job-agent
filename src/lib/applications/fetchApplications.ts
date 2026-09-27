import type { SupabaseClient } from "@supabase/supabase-js";
import { type ApplicationRecord, type ApplicationRow, mapApplicationRow } from "./types";

/** Fetches the caller's own applications for a set of match ids, keyed by matchId. RLS (applications_select_own) already scopes this to the caller. */
export async function fetchApplicationsForMatches(supabase: SupabaseClient, matchIds: string[]): Promise<Record<string, ApplicationRecord>> {
  if (matchIds.length === 0) return {};

  const { data, error } = await supabase
    .from("applications")
    .select("id, match_id, job_id, cover_letter_id, application_method, status, send_attempt_count, last_attempt_at, last_error, provider_message_id, approved_at")
    .in("match_id", matchIds);
  if (error) throw new Error(error.message);

  const result: Record<string, ApplicationRecord> = {};
  for (const row of (data ?? []) as ApplicationRow[]) {
    result[row.match_id] = mapApplicationRow(row);
  }
  return result;
}
