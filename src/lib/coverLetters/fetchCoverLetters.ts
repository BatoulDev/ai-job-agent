import type { SupabaseClient } from "@supabase/supabase-js";
import { type CoverLetterRecord, type CoverLetterRow, mapCoverLetterRow } from "./types";

/** Fetches the caller's own cover letters for a set of match ids, keyed by matchId. RLS (cover_letters_select_own) already scopes this to the caller. */
export async function fetchCoverLettersForMatches(supabase: SupabaseClient, matchIds: string[]): Promise<Record<string, CoverLetterRecord>> {
  if (matchIds.length === 0) return {};

  const { data, error } = await supabase
    .from("cover_letters")
    .select("id, match_id, generated_content, edited_content, approved_content, generation_status, approval_status")
    .in("match_id", matchIds);
  if (error) throw new Error(error.message);

  const result: Record<string, CoverLetterRecord> = {};
  for (const row of (data ?? []) as CoverLetterRow[]) {
    result[row.match_id] = mapCoverLetterRow(row);
  }
  return result;
}
