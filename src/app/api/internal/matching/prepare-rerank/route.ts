import { NextResponse } from "next/server";
import { handlePrepareRerankRequest } from "@/lib/matching/handlePrepareRerankRequest";

// Internal, service-to-service endpoint: the n8n "AI Job Guide / 02 Job
// Matching" workflow's rerank stage calls this to discover which (profile,
// job) pairs need an LLM score and get their exact grounded prompt, then
// calls its own OpenAI credential once per candidate (chat completions has
// no batch endpoint, unlike embeddings), then POSTs results to
// /api/internal/matching/save-rerank-results. This route never calls an LLM
// itself. Every real decision (auth, parsing, missing-config, response
// shape) lives in handlePrepareRerankRequest
// (src/lib/matching/handlePrepareRerankRequest.ts), which has no
// "next/server" dependency and is exercised directly by
// tests/db/matching-routes-http.test.mjs — this file is a trivial wrapper
// that cannot itself be imported under plain `node --test` ("next/server"
// has no ESM exports map), so it is not independently tested.
export async function POST(request: Request) {
  const { status, body } = await handlePrepareRerankRequest(request);
  return NextResponse.json(body, { status });
}
