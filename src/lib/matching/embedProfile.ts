// DB-touching orchestration for one user's approved-profile embedding
// (Phase 05). See embedJob.ts's header for why the embedding provider is
// injected rather than hardcoded.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProfileEmbeddingText, hashEmbeddingText, type ProfileEmbeddingInput } from "./embeddingText.ts";
import type { EmbeddingGenerator } from "./embedJob.ts";

export type EmbedProfileResult =
  | { updated: true; reason: "embedded" }
  | { updated: false; reason: "not_matching_eligible" | "unchanged" };

/**
 * Re-embeds a user's approved AI Career Profile only when it is currently
 * matching-eligible (public.is_cv_analysis_matching_eligible — the one
 * canonical gate every matching-adjacent consumer must call, per
 * supabase/migrations/20260825100010_add_matching_eligibility_gate.sql's own
 * governing comment) and only when its content has actually changed.
 */
export async function embedProfileIfEligible(
  supabase: SupabaseClient,
  cvAnalysisId: string,
  generateEmbedding: EmbeddingGenerator
): Promise<EmbedProfileResult> {
  const { data: eligible, error: eligibilityError } = await supabase.rpc("is_cv_analysis_matching_eligible", {
    p_analysis_id: cvAnalysisId,
  });
  if (eligibilityError) {
    throw new Error(`embedProfileIfEligible: eligibility check failed for ${cvAnalysisId}: ${eligibilityError.message}`);
  }
  if (!eligible) {
    return { updated: false, reason: "not_matching_eligible" };
  }

  const { data: analysis, error: analysisError } = await supabase
    .from("cv_analyses")
    .select("user_id, professional_summary, skills, recommended_roles, strongest_areas, profile_level, profile_embedding_content_hash")
    .eq("id", cvAnalysisId)
    .single();
  if (analysisError) throw new Error(`embedProfileIfEligible: failed to read analysis ${cvAnalysisId}: ${analysisError.message}`);

  const { data: preferences, error: preferencesError } = await supabase
    .from("job_preferences")
    .select("custom_target_roles, custom_locations, location, job_type, experience_level")
    .eq("user_id", analysis.user_id)
    .maybeSingle();
  if (preferencesError) {
    throw new Error(`embedProfileIfEligible: failed to read preferences for ${analysis.user_id}: ${preferencesError.message}`);
  }

  const input: ProfileEmbeddingInput = {
    professionalSummary: analysis.professional_summary,
    skills: (analysis.skills as string[] | null) ?? [],
    recommendedRoles: (analysis.recommended_roles as string[] | null) ?? [],
    strongestAreas: (analysis.strongest_areas as string[] | null) ?? [],
    profileLevel: analysis.profile_level,
    targetRoles: preferences?.custom_target_roles ?? [],
    preferredLocations: preferences?.custom_locations ?? (preferences?.location ? [preferences.location] : []),
    jobType: preferences?.job_type ?? null,
    experienceLevel: preferences?.experience_level ?? null,
  };
  const text = buildProfileEmbeddingText(input);
  const hash = hashEmbeddingText(text);

  if (analysis.profile_embedding_content_hash === hash) {
    return { updated: false, reason: "unchanged" };
  }

  const embedding = await generateEmbedding(text);

  const { error: updateError } = await supabase
    .from("cv_analyses")
    .update({
      profile_embedding: embedding,
      profile_embedding_content_hash: hash,
      profile_embedding_generated_at: new Date().toISOString(),
    })
    .eq("id", cvAnalysisId);
  if (updateError) {
    throw new Error(`embedProfileIfEligible: failed to persist embedding for ${cvAnalysisId}: ${updateError.message}`);
  }

  return { updated: true, reason: "embedded" };
}
