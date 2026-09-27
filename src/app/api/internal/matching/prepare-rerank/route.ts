import { NextResponse } from "next/server";
import { parsePrepareRerankRequestBody } from "./parsePrepareRerankRequest";
import { findRerankCandidates } from "@/lib/matching/rerankCandidates";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedInternalRequest } from "@/lib/internalAuth";

// Internal, service-to-service endpoint: the n8n "AI Job Agent / 02 Job
// Matching" workflow's rerank stage calls this to discover which (profile,
// job) pairs need an LLM score and get their exact grounded prompt, then
// calls its own OpenAI credential once per candidate (chat completions has
// no batch endpoint, unlike embeddings), then POSTs results to
// /api/internal/matching/save-rerank-results. This route never calls an LLM
// itself.
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

  const parsed = parsePrepareRerankRequestBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const candidates = await findRerankCandidates(supabase, parsed.value);
    return NextResponse.json({
      candidates: candidates.map((c) => ({ candidateId: c.candidateId, prompt: c.prompt })),
    });
  } catch (error) {
    console.error("prepare-rerank failed:", error);
    return NextResponse.json({ error: "Failed to prepare rerank candidates. See server logs." }, { status: 500 });
  }
}
