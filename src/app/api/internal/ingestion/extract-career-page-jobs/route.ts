import { NextResponse } from "next/server";
import { extractCareerPageJobPostings } from "@/lib/ingestion/extractCareerPageJobPostings";
import { isAuthorizedInternalRequest } from "@/lib/internalAuth";

// Internal, service-to-service endpoint (Phase 13, Tier B): n8n fetches a
// company's career page HTML directly (HTTP Request node, same pattern as
// every ATS feed fetch) and POSTs the raw HTML here for extraction — kept
// as its own TypeScript step rather than an n8n Code node parsing HTML
// (AGENTS.md §6 "do not create a giant Code node" in the Phase 13
// instructions), and rather than folding into run-batch, since this step
// only extracts RawProviderJob[]; it does not decide dedup/persistence.
// n8n calls run-batch (sourceType: "career_page") immediately after with
// this response's jobs — the same company-specific path Greenhouse/Lever/
// Workable/Ashby already use, since a career page belongs to exactly one
// company_sources row, unlike the multi-company feeds in Phase 13's other
// new endpoint.
//
// Request body size limit (AGENTS.md §27): a company careers page is
// realistically well under this; a wildly oversized body is rejected
// before ever reaching the parser.
const MAX_HTML_BYTES = 5_000_000;

export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request, "INGESTION_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const html = (rawBody as Record<string, unknown>).html;
  if (typeof html !== "string") {
    return NextResponse.json({ error: "html must be a string" }, { status: 400 });
  }
  if (html.length > MAX_HTML_BYTES) {
    return NextResponse.json({ error: `html exceeds the maximum of ${MAX_HTML_BYTES} characters` }, { status: 400 });
  }

  try {
    const jobs = extractCareerPageJobPostings(html);
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error("extract-career-page-jobs failed:", error);
    return NextResponse.json({ error: "Extraction failed. See server logs." }, { status: 500 });
  }
}
