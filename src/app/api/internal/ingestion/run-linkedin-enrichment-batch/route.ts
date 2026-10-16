import { NextResponse } from "next/server";
import { parseLinkedInEnrichmentBatchRequestBody } from "./parseLinkedInEnrichmentBatchRequest";
import { applyLinkedInEnrichmentBatch } from "@/lib/ingestion/applyLinkedInEnrichmentBatch";
import { buildEnrichmentItemsFromDataset } from "@/lib/ingestion/linkedinEnrichment";
import { isProviderEnabled } from "@/lib/ingestion/providerConfig";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedInternalRequest } from "@/lib/internalAuth";

// Internal, service-to-service endpoint: the enrichment orchestration
// pass fetches data-slayer's raw exact-ID dataset response for a bounded
// batch of already-discovered LinkedIn job ids and POSTs both the
// requested id list and that raw dataset here, verbatim. This route
// reconciles the two (buildEnrichmentItemsFromDataset — matches by
// job_posting_id, safe against a partial/reordered/short dataset) and
// applies the result to already-persisted jobs rows via
// applyLinkedInEnrichmentBatch, which re-checks eligibility live per job
// (never trusts a cached queue selection). Same shared-secret auth as
// every other internal ingestion endpoint — never called from a browser.
//
// Gated on isProviderEnabled("linkedin"), same discipline as
// run-multi-company-batch — this keeps the endpoint structurally inert
// in production while providerConfig.ts's linkedin.enabled stays false,
// regardless of whether this code exists.
export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request, "INGESTION_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isProviderEnabled("linkedin")) {
    return NextResponse.json({ error: 'Provider "linkedin" is not currently enabled' }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = parseLinkedInEnrichmentBatchRequestBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const items = buildEnrichmentItemsFromDataset(parsed.value.requestedJobIds, parsed.value.rawDatasetItems);
    const result = await applyLinkedInEnrichmentBatch(supabase, items);
    return NextResponse.json(result);
  } catch (error) {
    console.error("LinkedIn enrichment batch failed:", error);
    return NextResponse.json({ error: "Enrichment batch failed. See server logs." }, { status: 500 });
  }
}
