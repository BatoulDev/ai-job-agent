// DB-touching orchestration for one user's approved-profile embedding
// (Phase 05). See embedJob.ts's header for why the embedding provider is
// injected rather than hardcoded.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProfileEmbeddingText, hashEmbeddingText, type ProfileEmbeddingInput } from "./embeddingText.ts";
import type { EmbeddingGenerator } from "./embedJob.ts";

export type EmbedProfileResult =
  | { updated: true; reason: "embedded" }
  | { updated: false; reason: "not_matching_eligible" | "unchanged" };

interface AnalysisRow {
  professional_summary: string | null;
  skills: unknown;
  recommended_roles: unknown;
  strongest_areas: unknown;
  profile_level: string | null;
}

interface PreferencesRow {
  custom_target_roles: string[] | null;
  custom_locations: string[] | null;
  location: string | null;
  job_type: string | null;
  experience_level: string | null;
}

function buildProfileEmbeddingInput(analysis: AnalysisRow, preferences: PreferencesRow | null): ProfileEmbeddingInput {
  return {
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
}

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

  const text = buildProfileEmbeddingText(buildProfileEmbeddingInput(analysis, preferences));
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

// ── Two-step split for an external caller (n8n) that owns the embedding-
// provider call itself — see embedJob.ts's equivalent section header for
// the full rationale.

export interface PendingProfileEmbedding {
  cvAnalysisId: string;
  text: string;
  contentHash: string;
}

/**
 * Bounded discovery query: matching-eligible analyses with no profile
 * embedding yet. Scoped to review_status/is_current/recommendations_state
 * (the parts of is_cv_analysis_matching_eligible() expressible as a plain
 * filter) as a cheap pre-filter for a batch scan — the authoritative
 * per-row RPC check still runs again in saveProfileEmbedding() below before
 * anything is persisted, so this pre-filter can never itself become the
 * source of truth for "is this actually eligible."
 */
export async function findProfilesNeedingEmbedding(supabase: SupabaseClient, limit: number): Promise<PendingProfileEmbedding[]> {
  const { data: candidates, error } = await supabase
    .from("cv_analyses")
    .select("id, user_id, professional_summary, skills, recommended_roles, strongest_areas, profile_level")
    .eq("review_status", "approved")
    .eq("is_current", true)
    .eq("recommendations_state", "current")
    .is("profile_embedding", null)
    .limit(limit);
  if (error) throw new Error(`findProfilesNeedingEmbedding: query failed: ${error.message}`);
  if (!candidates || candidates.length === 0) return [];

  const userIds = [...new Set(candidates.map((c) => c.user_id))];
  const { data: preferencesRows, error: preferencesError } = await supabase
    .from("job_preferences")
    .select("user_id, custom_target_roles, custom_locations, location, job_type, experience_level")
    .in("user_id", userIds);
  if (preferencesError) throw new Error(`findProfilesNeedingEmbedding: preferences query failed: ${preferencesError.message}`);
  const preferencesByUser = new Map((preferencesRows ?? []).map((p) => [p.user_id, p]));

  return candidates.map((analysis) => {
    const text = buildProfileEmbeddingText(buildProfileEmbeddingInput(analysis, preferencesByUser.get(analysis.user_id) ?? null));
    return { cvAnalysisId: analysis.id, text, contentHash: hashEmbeddingText(text) };
  });
}

export type SaveProfileEmbeddingResult = { saved: true } | { saved: false; reason: "not_matching_eligible" };

/**
 * Persists an embedding computed externally for an analysis already
 * returned by findProfilesNeedingEmbedding() — but re-verifies
 * is_cv_analysis_matching_eligible() first, since eligibility can change
 * between discovery and this call (e.g. the user edited preferences or a
 * re-analysis superseded it in between).
 */
export async function saveProfileEmbedding(
  supabase: SupabaseClient,
  cvAnalysisId: string,
  embedding: number[],
  contentHash: string
): Promise<SaveProfileEmbeddingResult> {
  const { data: eligible, error: eligibilityError } = await supabase.rpc("is_cv_analysis_matching_eligible", {
    p_analysis_id: cvAnalysisId,
  });
  if (eligibilityError) {
    throw new Error(`saveProfileEmbedding: eligibility check failed for ${cvAnalysisId}: ${eligibilityError.message}`);
  }
  if (!eligible) {
    return { saved: false, reason: "not_matching_eligible" };
  }

  const { error } = await supabase
    .from("cv_analyses")
    .update({ profile_embedding: embedding, profile_embedding_content_hash: contentHash, profile_embedding_generated_at: new Date().toISOString() })
    .eq("id", cvAnalysisId);
  if (error) throw new Error(`saveProfileEmbedding: failed to persist embedding for ${cvAnalysisId}: ${error.message}`);

  return { saved: true };
}
