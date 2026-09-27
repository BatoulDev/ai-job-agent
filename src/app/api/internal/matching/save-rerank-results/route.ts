import { NextResponse } from "next/server";
import { parseSaveRerankResultsRequestBody } from "./parseSaveRerankResultsRequest";
import { decodeCandidateId } from "@/lib/matching/rerankCandidates";
import { parseRerankResponse } from "@/lib/matching/rerankResponse";
import { saveMatchResult } from "@/lib/matching/saveMatch";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedInternalRequest } from "@/lib/internalAuth";
import type { SupabaseClient } from "@supabase/supabase-js";

type SaveOutcome = "saved" | "invalid_candidate_id" | "invalid_response" | "not_matching_eligible" | "save_failed";

async function saveOneResult(
  supabase: SupabaseClient,
  matchingModel: string,
  candidateId: string,
  rawResponse: unknown
): Promise<SaveOutcome> {
  const decoded = decodeCandidateId(candidateId);
  if (!decoded) return "invalid_candidate_id";

  const parsedResponse = parseRerankResponse(rawResponse);
  if (!parsedResponse.ok) return "invalid_response";

  // Re-verified here, not just trusted from prepare-rerank's discovery pass
  // — eligibility can change between discovery and this call (AGENTS.md
  // §30/§18: never persist AI output against a subject that is no longer
  // valid, matching the exact pattern already used by saveProfileEmbedding).
  const { data: eligible, error: eligibilityError } = await supabase.rpc("is_cv_analysis_matching_eligible", {
    p_analysis_id: decoded.cvAnalysisId,
  });
  if (eligibilityError) throw new Error(`eligibility check failed: ${eligibilityError.message}`);
  if (!eligible) return "not_matching_eligible";

  const { data: analysis, error: analysisError } = await supabase
    .from("cv_analyses")
    .select("user_id")
    .eq("id", decoded.cvAnalysisId)
    .maybeSingle();
  if (analysisError) throw new Error(`analysis lookup failed: ${analysisError.message}`);
  if (!analysis) return "not_matching_eligible";

  try {
    await saveMatchResult(supabase, {
      userId: analysis.user_id,
      jobId: decoded.jobId,
      cvAnalysisId: decoded.cvAnalysisId,
      result: parsedResponse.value,
      matchingModel,
    });
  } catch {
    return "save_failed";
  }
  return "saved";
}

// Internal, service-to-service endpoint: persists LLM rerank results the
// n8n workflow already computed. Every response is re-validated against the
// strict schema here (never trusted just because it round-tripped through
// n8n) and every profile is re-checked for matching eligibility immediately
// before writing.
export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request, "MATCHING_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = parseSaveRerankResultsRequestBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const supabase = createAdminClient();
  const counts: Record<SaveOutcome, number> = {
    saved: 0,
    invalid_candidate_id: 0,
    invalid_response: 0,
    not_matching_eligible: 0,
    save_failed: 0,
  };

  try {
    for (const item of parsed.value.results) {
      const outcome = await saveOneResult(supabase, parsed.value.matchingModel, item.candidateId, item.response);
      counts[outcome]++;
    }
  } catch (error) {
    console.error("save-rerank-results failed partway through:", error);
    return NextResponse.json({ error: "Failed to save rerank results. See server logs.", ...counts }, { status: 500 });
  }

  return NextResponse.json(counts);
}
