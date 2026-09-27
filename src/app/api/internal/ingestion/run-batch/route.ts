import { NextResponse } from "next/server";
import { parseIngestionBatchRequestBody } from "./parseIngestionBatchRequest";
import { getProviderAdapter } from "@/lib/ingestion/providers";
import { runIngestionBatch } from "@/lib/ingestion/ingestSourceBatch";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedInternalRequest } from "@/lib/internalAuth";

// Internal, service-to-service endpoint: the Phase 04 n8n ingestion
// orchestrator fetches each source's raw job list (its job — "provider
// calls," AGENTS.md §11) and POSTs the raw vendor JSON here, which owns
// mapping/validation/dedup/persistence (TypeScript's job, same section) via
// the already-tested Phase 03 pipeline. Never called from a browser — there
// is no user session, no RLS-scoped client, and no rate limit tied to a
// user id, so authorization is a single shared secret instead (fails
// closed if unconfigured, per AGENTS.md §21 "no insecure fallback secret").

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

  const parsed = parseIngestionBatchRequestBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { sourceId, sourceType, rawJobs, maxJobsPerSource, dryRun } = parsed.value;

  const adapter = getProviderAdapter(sourceType);
  if (!adapter) {
    // Already checked in parseIngestionBatchRequestBody; kept here so this
    // route never silently proceeds if that invariant ever drifts.
    return NextResponse.json({ error: `No provider adapter registered for sourceType "${sourceType}"` }, { status: 400 });
  }

  try {
    const mappedJobs = rawJobs.map((raw) => adapter(raw));
    const supabase = createAdminClient();
    const result = await runIngestionBatch(supabase, sourceId, sourceType, mappedJobs, { maxJobsPerSource, dryRun });
    return NextResponse.json(result);
  } catch (error) {
    // Never mark an ingestion run successful when its DB write result is
    // unknown (AGENTS.md §18/§30) — surface a generic 500 to the caller
    // while logging real detail server-side only.
    console.error(`Ingestion batch failed for source ${sourceId}:`, error);
    return NextResponse.json({ error: "Ingestion batch failed. See server logs." }, { status: 500 });
  }
}
