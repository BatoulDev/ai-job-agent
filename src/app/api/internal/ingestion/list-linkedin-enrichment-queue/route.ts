import { NextResponse } from "next/server";
import { findEligibleLinkedInEnrichmentJobs } from "@/lib/ingestion/findEligibleLinkedInEnrichmentJobs";
import { isProviderEnabled } from "@/lib/ingestion/providerConfig";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedInternalRequest } from "@/lib/internalAuth";

// Internal, service-to-service endpoint: the enrichment orchestration
// pass calls this once per run to get a bounded batch of already-
// persisted LinkedIn job ids that still need a data-slayer exact-ID
// call (work_arrangement IS NULL AND linkedin_enrichment_attempts < 2).
// No request body — same no-param convenience-discovery shape as
// list-sources/route.ts. Returns an empty list while the provider stays
// disabled, so a caller that loops over job_ids naturally does nothing
// without needing its own separate enabled check — same structurally-
// inert-while-disabled posture as run-linkedin-enrichment-batch/route.ts.
export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request, "INGESTION_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isProviderEnabled("linkedin")) {
    return NextResponse.json({ job_ids: [] });
  }

  try {
    const supabase = createAdminClient();
    const jobs = await findEligibleLinkedInEnrichmentJobs(supabase);
    return NextResponse.json({ job_ids: jobs.map((j) => j.externalId) });
  } catch (error) {
    console.error("list-linkedin-enrichment-queue failed:", error);
    return NextResponse.json({ error: "Failed to list eligible LinkedIn enrichment jobs. See server logs." }, { status: 500 });
  }
}
