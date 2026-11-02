// Checkpoint 2E audit-remediation: the real request-handling logic for
// POST /api/internal/matching/save-rerank-results, extracted out of
// route.ts so it has NO dependency on "next/server" — that package has no
// ESM "exports" map, so anything importing it (even transitively) cannot
// be loaded under plain `node --test`, a hard platform constraint
// unrelated to any "@/" alias fix. route.ts itself stays a trivial
// two-line wrapper (NextResponse.json(body, {status})) that is not
// independently exercised by this test suite — only this function is,
// which carries every real decision (auth, parsing, missing-config,
// per-item processing, response shape).
import { parseSaveRerankResultsRequestBody } from "../../app/api/internal/matching/save-rerank-results/parseSaveRerankResultsRequest.ts";
import { saveOneRerankResult, EMPTY_SAVE_OUTCOME_COUNTS } from "./saveRerankResult.ts";
import { createAdminClient } from "../supabase/admin.ts";
import { isAuthorizedInternalRequest } from "../internalAuth.ts";

export interface HandledResponse {
  status: number;
  body: unknown;
}

export async function handleSaveRerankResultsRequest(request: Request): Promise<HandledResponse> {
  if (!isAuthorizedInternalRequest(request, "MATCHING_WORKER_SECRET")) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  // Checkpoint 2E: fail closed on a missing signing secret for the WHOLE
  // request, before any per-item work — same posture as the bearer-secret
  // check above. decodeCandidateId would also report "missing_secret" per
  // item, but checking once here gives a clear configuration-error
  // response instead of 200 full of unverifiable rejections.
  if (!process.env.MATCHING_CANDIDATE_TOKEN_SECRET) {
    console.error("save-rerank-results: MATCHING_CANDIDATE_TOKEN_SECRET is not configured");
    return { status: 500, body: { error: "Server misconfiguration: candidate token secret is not set." } };
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return { status: 400, body: { error: "Invalid request body" } };
  }

  const parsed = parseSaveRerankResultsRequestBody(rawBody);
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.error } };
  }

  const supabase = createAdminClient();
  const counts = { ...EMPTY_SAVE_OUTCOME_COUNTS };

  // saveOneRerankResult now contains every failure itself (see its own
  // header comment) — this try/catch is defense-in-depth for something
  // outside the per-item loop entirely, not the per-item isolation
  // mechanism.
  try {
    for (const item of parsed.value.results) {
      const outcome = await saveOneRerankResult(supabase, parsed.value.matchingModel, item.candidateId, item.response);
      counts[outcome]++;
    }
  } catch (error) {
    console.error("save-rerank-results failed partway through:", error);
    return { status: 500, body: { error: "Failed to save rerank results. See server logs.", ...counts } };
  }

  return { status: 200, body: counts };
}
