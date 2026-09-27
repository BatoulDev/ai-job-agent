import type { SupabaseClient } from "@supabase/supabase-js";
import { type ApplicationOutcomeRecord, type ApplicationOutcomeRow, mapApplicationOutcomeRow } from "./outcomeTypes";

/** Fetches the caller's own outcome rows for a set of application ids, keyed by applicationId. RLS (application_outcomes_select_own) already scopes this to the caller. */
export async function fetchOutcomesForApplications(supabase: SupabaseClient, applicationIds: string[]): Promise<Record<string, ApplicationOutcomeRecord>> {
  if (applicationIds.length === 0) return {};

  const { data, error } = await supabase.from("application_outcomes").select("id, application_id, outcome_status, notes, updated_at").in("application_id", applicationIds);
  if (error) throw new Error(error.message);

  const result: Record<string, ApplicationOutcomeRecord> = {};
  for (const row of (data ?? []) as ApplicationOutcomeRow[]) {
    result[row.application_id] = mapApplicationOutcomeRow(row);
  }
  return result;
}
