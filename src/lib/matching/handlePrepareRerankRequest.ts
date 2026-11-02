// Checkpoint 2E audit-remediation: the real request-handling logic for
// POST /api/internal/matching/prepare-rerank, extracted out of route.ts so
// it has NO dependency on "next/server" — that package has no ESM
// "exports" map, so anything importing it (even transitively) cannot be
// loaded under plain `node --test`, a hard platform constraint unrelated
// to any "@/" alias fix. route.ts itself stays a trivial two-line wrapper
// (NextResponse.json(body, {status})) that is not independently
// exercised by this test suite — only this function is, which carries
// every real decision (auth, parsing, missing-config, response shape).
import { parsePrepareRerankRequestBody } from "../../app/api/internal/matching/prepare-rerank/parsePrepareRerankRequest.ts";
import { findRerankCandidates } from "./rerankCandidates.ts";
import { createAdminClient } from "../supabase/admin.ts";
import { isAuthorizedInternalRequest } from "../internalAuth.ts";

export interface HandledResponse {
  status: number;
  body: unknown;
}

export async function handlePrepareRerankRequest(request: Request): Promise<HandledResponse> {
  if (!isAuthorizedInternalRequest(request, "MATCHING_WORKER_SECRET")) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  // Checkpoint 2E: fail closed with a clear configuration error — without
  // this, signCandidateToken() would throw on the first candidate anyway
  // (caught by the try/catch below), but checking explicitly up front
  // gives a specific, immediate error instead of relying on that side
  // effect.
  if (!process.env.MATCHING_CANDIDATE_TOKEN_SECRET) {
    console.error("prepare-rerank: MATCHING_CANDIDATE_TOKEN_SECRET is not configured");
    return { status: 500, body: { error: "Server misconfiguration: candidate token secret is not set." } };
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return { status: 400, body: { error: "Invalid request body" } };
  }

  const parsed = parsePrepareRerankRequestBody(rawBody);
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.error } };
  }

  try {
    const supabase = createAdminClient();
    const candidates = await findRerankCandidates(supabase, parsed.value);
    return {
      status: 200,
      body: { candidates: candidates.map((c) => ({ candidateId: c.candidateId, prompt: c.prompt })) },
    };
  } catch (error) {
    console.error("prepare-rerank failed:", error);
    return { status: 500, body: { error: "Failed to prepare rerank candidates. See server logs." } };
  }
}
