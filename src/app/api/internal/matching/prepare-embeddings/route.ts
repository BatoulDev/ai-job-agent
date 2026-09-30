import { NextResponse } from "next/server";
import { parsePrepareEmbeddingsRequestBody } from "./parsePrepareEmbeddingsRequest";
import { findJobsNeedingEmbedding } from "@/lib/matching/embedJob";
import { findProfilesNeedingEmbedding } from "@/lib/matching/embedProfile";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedInternalRequest } from "@/lib/internalAuth";

// Internal, service-to-service endpoint: the n8n "AI Job Guide / 02 Job
// Matching" workflow calls this first to discover which jobs/profiles need
// an embedding, then calls its own OpenAI credential (n8n owns the
// provider call, per the Phase 05 architecture decision — see
// docs/OVERNIGHT_BUILD_PROGRESS.md), then POSTs the results to
// /api/internal/matching/save-embeddings. This route never calls an
// embeddings provider itself — it only decides *what* needs embedding.
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

  const parsed = parsePrepareEmbeddingsRequestBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const [jobs, profiles] = await Promise.all([
      findJobsNeedingEmbedding(supabase, parsed.value.jobLimit),
      findProfilesNeedingEmbedding(supabase, parsed.value.profileLimit),
    ]);
    return NextResponse.json({ jobs, profiles });
  } catch (error) {
    console.error("prepare-embeddings failed:", error);
    return NextResponse.json({ error: "Failed to prepare embeddings. See server logs." }, { status: 500 });
  }
}
