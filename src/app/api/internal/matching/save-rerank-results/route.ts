import { NextResponse } from "next/server";
import { handleSaveRerankResultsRequest } from "@/lib/matching/handleSaveRerankResultsRequest";

// Internal, service-to-service endpoint: persists LLM rerank results the
// n8n workflow already computed. Every response is re-validated against the
// strict schema here (never trusted just because it round-tripped through
// n8n), every candidate token is cryptographically verified (Checkpoint
// 2E), and every profile AND job is re-checked for matching eligibility
// immediately before writing. Every real decision (auth, parsing,
// missing-config, per-item processing, response shape) lives in
// handleSaveRerankResultsRequest (src/lib/matching/handleSaveRerankResultsRequest.ts),
// which has no "next/server" dependency and is exercised directly by
// tests/db/matching-routes-http.test.mjs — this file is a trivial wrapper
// that cannot itself be imported under plain `node --test` ("next/server"
// has no ESM exports map), so it is not independently tested.
export async function POST(request: Request) {
  const { status, body } = await handleSaveRerankResultsRequest(request);
  return NextResponse.json(body, { status });
}
