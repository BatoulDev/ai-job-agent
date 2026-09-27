// Persistence for one cover-letter generation attempt (Phase 08). Re-checks
// state immediately before writing rather than trusting prepare-generation's
// earlier discovery pass — the match could have been rejected, or the letter
// could have been approved by the user, in the time between discovery and
// this call (same defensive-recheck pattern as saveMatchResult /
// save-rerank-results). An approved cover_letters row (approved_content
// frozen) is never touched by generation again.
import type { SupabaseClient } from "@supabase/supabase-js";

export type SaveCoverLetterOutcome = "saved" | "match_not_approved" | "already_approved" | "save_failed";

async function loadTarget(supabase: SupabaseClient, matchId: string) {
  const { data: match, error: matchError } = await supabase.from("matches").select("user_id, status").eq("id", matchId).maybeSingle();
  if (matchError) throw new Error(`loadTarget: match lookup failed: ${matchError.message}`);
  if (!match || match.status !== "user_approved") return null;

  const { data: existing, error: existingError } = await supabase
    .from("cover_letters")
    .select("id, approval_status")
    .eq("match_id", matchId)
    .maybeSingle();
  if (existingError) throw new Error(`loadTarget: cover_letters lookup failed: ${existingError.message}`);
  if (existing?.approval_status === "user_approved") return "already_approved" as const;

  return { userId: match.user_id, existingId: existing?.id ?? null };
}

/** Persists a successfully generated draft. */
export async function saveCoverLetterDraft(
  supabase: SupabaseClient,
  input: { matchId: string; content: string; modelProvider: string; modelVersion: string }
): Promise<SaveCoverLetterOutcome> {
  const target = await loadTarget(supabase, input.matchId);
  if (target === null) return "match_not_approved";
  if (target === "already_approved") return "already_approved";

  const fields = {
    generated_content: input.content,
    generation_status: "completed" as const,
    model_provider: input.modelProvider,
    model_version: input.modelVersion,
  };

  const { error } = target.existingId
    ? await supabase.from("cover_letters").update(fields).eq("id", target.existingId)
    : await supabase.from("cover_letters").insert({ user_id: target.userId, match_id: input.matchId, ...fields });
  if (error) return "save_failed";
  return "saved";
}
