import { NextResponse } from "next/server";
import { parseSaveEmbeddingsRequestBody } from "./parseSaveEmbeddingsRequest";
import { saveJobEmbedding } from "@/lib/matching/embedJob";
import { saveProfileEmbedding } from "@/lib/matching/embedProfile";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedInternalRequest } from "@/lib/internalAuth";

// Internal, service-to-service endpoint: the n8n "AI Job Agent / 02 Job
// Matching" workflow POSTs here after computing embeddings itself (via its
// own OpenAI credential) for whatever /api/internal/matching/prepare-embeddings
// told it needed one. Each profile is re-verified against
// is_cv_analysis_matching_eligible() here (see saveProfileEmbedding) before
// persisting — eligibility can change between discovery and this call.
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

  const parsed = parseSaveEmbeddingsRequestBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const supabase = createAdminClient();
  let jobsSaved = 0;
  let profilesSaved = 0;
  let profilesSkipped = 0;

  try {
    for (const job of parsed.value.jobs) {
      await saveJobEmbedding(supabase, job.jobId, job.embedding, job.contentHash);
      jobsSaved++;
    }
    for (const profile of parsed.value.profiles) {
      const result = await saveProfileEmbedding(supabase, profile.cvAnalysisId, profile.embedding, profile.contentHash);
      if (result.saved) profilesSaved++;
      else profilesSkipped++;
    }
  } catch (error) {
    console.error("save-embeddings failed partway through:", error);
    return NextResponse.json(
      { error: "Failed to save embeddings. See server logs.", jobsSaved, profilesSaved, profilesSkipped },
      { status: 500 }
    );
  }

  return NextResponse.json({ jobsSaved, profilesSaved, profilesSkipped });
}
