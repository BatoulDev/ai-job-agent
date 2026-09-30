import { NextResponse } from "next/server";
import { parsePrepareGenerationRequestBody } from "./parsePrepareGenerationRequest";
import { findCoverLetterCandidates } from "@/lib/coverLetters/candidates";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedInternalRequest } from "@/lib/internalAuth";

// Internal, service-to-service endpoint: the n8n "AI Job Guide / 03 Cover
// Letter Generation" workflow calls this to discover which approved matches
// still need a cover-letter draft (or need a retry after a previous
// failure), and gets each one's exact grounded prompt. It then calls its own
// OpenAI credential once per candidate (chat completions has no batch
// endpoint) and POSTs results to /api/internal/cover-letters/save-generation.
// This route never calls an LLM itself.
export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request, "COVER_LETTER_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = parsePrepareGenerationRequestBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const candidates = await findCoverLetterCandidates(supabase, parsed.value.limit);
    return NextResponse.json({ candidates });
  } catch (error) {
    console.error("prepare-generation failed:", error);
    return NextResponse.json({ error: "Failed to prepare cover-letter candidates. See server logs." }, { status: 500 });
  }
}
