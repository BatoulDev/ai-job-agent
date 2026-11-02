// Checkpoint 2E: extracted out of save-rerank-results/route.ts so it can
// be unit-tested directly (a route.ts file may only export the specific
// HTTP-method/config names Next.js's build validates — an arbitrary extra
// export there risks a build-time "unsupported route export" error; a
// plain lib module has no such restriction) and so business logic stays
// out of the thin route handler (AGENTS.md §16).
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeCandidateId, loadUserContext } from "./rerankCandidates.ts";
import { parseRerankResponse } from "./rerankResponse.ts";
import { saveMatchResult } from "./saveMatch.ts";
import { revalidateJobEligibilityForSave } from "./revalidateJobEligibility.ts";

export type SaveOutcome =
  | "saved"
  | "invalid_candidate_id"
  | "invalid_candidate_signature"
  | "candidate_token_expired"
  | "invalid_response"
  | "not_matching_eligible"
  | "job_no_longer_eligible"
  | "revalidation_failed"
  | "save_failed";

export const EMPTY_SAVE_OUTCOME_COUNTS: Record<SaveOutcome, number> = {
  saved: 0,
  invalid_candidate_id: 0,
  invalid_candidate_signature: 0,
  candidate_token_expired: 0,
  invalid_response: 0,
  not_matching_eligible: 0,
  job_no_longer_eligible: 0,
  revalidation_failed: 0,
  save_failed: 0,
};

/**
 * Checkpoint 2E: the ENTIRE body is wrapped in one try/catch (fixing a
 * real pre-existing batch-isolation bug — previously only the final
 * saveMatchResult call was caught; an exception from the eligibility RPC
 * or the cv_analyses lookup propagated out of this function and aborted
 * every SUBSEQUENT item in the same save-rerank-results call). Adding the
 * new token-verification and revalidation steps gives this function
 * several more ways to throw, making that isolation fix load-bearing —
 * one bad candidate must never prevent the next valid one from saving.
 */
export async function saveOneRerankResult(
  supabase: SupabaseClient,
  matchingModel: string,
  candidateId: string,
  rawResponse: unknown
): Promise<SaveOutcome> {
  try {
    const decoded = decodeCandidateId(candidateId);
    if (!decoded.ok) {
      if (decoded.reason === "expired") return "candidate_token_expired";
      if (decoded.reason === "invalid_format") return "invalid_candidate_id";
      // invalid_signature | unsupported_version | future_issued | missing_secret
      // — all mean "do not trust this token", bucketed together; the
      // route handler's own up-front check means missing_secret should
      // never actually reach here in normal operation.
      return "invalid_candidate_signature";
    }
    const { cvAnalysisId, jobId } = decoded.value;

    const parsedResponse = parseRerankResponse(rawResponse);
    if (!parsedResponse.ok) return "invalid_response";

    // Re-verified here, not just trusted from prepare-rerank's discovery
    // pass — eligibility can change between discovery and this call
    // (AGENTS.md §30/§18: never persist AI output against a subject that
    // is no longer valid). This is the PROFILE-level check; job-level
    // revalidation follows below.
    const { data: eligible, error: eligibilityError } = await supabase.rpc("is_cv_analysis_matching_eligible", {
      p_analysis_id: cvAnalysisId,
    });
    if (eligibilityError) throw new Error(`eligibility check failed: ${eligibilityError.message}`);
    if (!eligible) return "not_matching_eligible";

    const { data: analysis, error: analysisError } = await supabase
      .from("cv_analyses")
      .select("user_id")
      .eq("id", cvAnalysisId)
      .maybeSingle();
    if (analysisError) throw new Error(`analysis lookup failed: ${analysisError.message}`);
    if (!analysis) return "not_matching_eligible";

    // Checkpoint 2E: authoritative job-level revalidation against CURRENT
    // data — status, freshness, verified locations, and the user's
    // reloaded plan/relocation/preference context, via the exact same
    // isJobEligibleGivenLocations decision shortlistJobsForUser uses at
    // discovery time. Never a second rule implementation.
    const userContext = await loadUserContext(supabase, analysis.user_id);
    const revalidation = await revalidateJobEligibilityForSave(supabase, jobId, userContext);
    if (!revalidation.eligible) return "job_no_longer_eligible";

    try {
      await saveMatchResult(supabase, {
        userId: analysis.user_id,
        jobId,
        cvAnalysisId,
        result: parsedResponse.value,
        matchingModel,
      });
    } catch {
      return "save_failed";
    }
    return "saved";
  } catch (error) {
    // Any other failure (the eligibility RPC, the analysis lookup, or
    // revalidation's own DB reads) — contained here, never propagated to
    // the surrounding batch loop. Fail closed: never falls through to a
    // save on an unconfirmed check.
    console.error("saveOneRerankResult: revalidation infrastructure failure for one candidate:", error instanceof Error ? error.message : error);
    return "revalidation_failed";
  }
}
