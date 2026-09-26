import { NextResponse } from "next/server";
import { parseSaveGenerationRequestBody, type GenerationResultToSave } from "./parseSaveGenerationRequest";
import { parseCoverLetterResponse } from "@/lib/coverLetters/response";
import { saveCoverLetterDraft } from "@/lib/coverLetters/saveCoverLetter";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedInternalRequest } from "@/lib/internalAuth";
import type { SupabaseClient } from "@supabase/supabase-js";

type SaveOutcome = "saved" | "invalid_response" | "match_not_approved" | "already_approved" | "save_failed";

async function saveOneResult(
  supabase: SupabaseClient,
  modelProvider: string,
  modelVersion: string,
  item: GenerationResultToSave
): Promise<SaveOutcome> {
  const parsed = parseCoverLetterResponse(item.response);
  if (!parsed.ok) return "invalid_response";

  return saveCoverLetterDraft(supabase, { matchId: item.matchId, content: parsed.value, modelProvider, modelVersion });
}

// Internal, service-to-service endpoint: persists cover-letter drafts the
// n8n workflow already generated. Every response is re-validated here (never
// trusted just because it round-tripped through n8n), and the target match's
// approval state is re-checked immediately before writing.
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

  const parsed = parseSaveGenerationRequestBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const supabase = createAdminClient();
  const counts: Record<SaveOutcome, number> = {
    saved: 0,
    invalid_response: 0,
    match_not_approved: 0,
    already_approved: 0,
    save_failed: 0,
  };

  try {
    for (const item of parsed.value.results) {
      const outcome = await saveOneResult(supabase, parsed.value.modelProvider, parsed.value.modelVersion, item);
      counts[outcome]++;
    }
  } catch (error) {
    console.error("save-generation failed partway through:", error);
    return NextResponse.json({ error: "Failed to save cover-letter results. See server logs.", ...counts }, { status: 500 });
  }

  return NextResponse.json(counts);
}
