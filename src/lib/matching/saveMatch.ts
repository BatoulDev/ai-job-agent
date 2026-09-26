// Idempotent match persistence (Phase 06). Uses the existing
// matches_user_job_analysis_key unique index (20260809090040_create_matches.sql)
// as the upsert conflict target — re-scoring the same (user, job, analysis)
// triple updates the same row rather than duplicating it, matching that
// migration's own documented intent ("idempotent reruns").
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RerankResult } from "./rerankResponse.ts";

export interface SaveMatchInput {
  userId: string;
  jobId: string;
  cvAnalysisId: string;
  result: RerankResult;
  matchingModel: string;
}

export async function saveMatchResult(supabase: SupabaseClient, input: SaveMatchInput): Promise<void> {
  const { error } = await supabase.from("matches").upsert(
    {
      user_id: input.userId,
      job_id: input.jobId,
      cv_analysis_id: input.cvAnalysisId,
      hard_filter_passed: true,
      score: input.result.score,
      score_breakdown: {
        strengths: input.result.strengths,
        preference_alignment: input.result.preferenceAlignment,
      },
      explanation: input.result.reason,
      missing_skills: input.result.missingSkills,
      matching_model: input.matchingModel,
    },
    { onConflict: "user_id,job_id,cv_analysis_id" }
  );
  if (error) {
    throw new Error(`saveMatchResult: failed to persist match for user ${input.userId}, job ${input.jobId}: ${error.message}`);
  }
}
