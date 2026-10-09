import { NextResponse } from "next/server";
import { parseMultiCompanyIngestionBatchRequestBody } from "./parseMultiCompanyIngestionBatchRequest";
import { getProviderAdapter } from "@/lib/ingestion/providers";
import { runMultiCompanyIngestionBatch } from "@/lib/ingestion/ingestSourceBatch";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedInternalRequest } from "@/lib/internalAuth";

// Internal, service-to-service endpoint (Phase 13): the multi-company-feed
// counterpart to run-batch/route.ts. The n8n orchestrator fetches one
// provider's raw job list (e.g. RemoteOK's /api array) and POSTs it here;
// this route maps + validates + persists via runMultiCompanyIngestionBatch,
// which re-checks the provider is actually enabled live (never trusts a
// cached decision) before writing anything. Same shared secret auth as
// every other internal ingestion endpoint — never called from a browser.
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

  const parsed = parseMultiCompanyIngestionBatchRequestBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { sourceType, rawJobs, maxJobsPerSource, dryRun, refreshScope } = parsed.value;

  const adapter = getProviderAdapter(sourceType);
  if (!adapter) {
    return NextResponse.json({ error: `No provider adapter registered for sourceType "${sourceType}"` }, { status: 400 });
  }

  try {
    const mappedJobs = rawJobs.map((raw) => adapter(raw));
    const supabase = createAdminClient();
    const result = await runMultiCompanyIngestionBatch(supabase, sourceType, mappedJobs, { maxJobsPerSource, dryRun }, refreshScope);
    return NextResponse.json(result);
  } catch (error) {
    console.error(`Multi-company ingestion batch failed for provider ${sourceType}:`, error);
    return NextResponse.json({ error: "Ingestion batch failed. See server logs." }, { status: 500 });
  }
}
