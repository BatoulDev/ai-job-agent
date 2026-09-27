import { NextResponse } from "next/server";
import { findEligibleCompanySources } from "@/lib/ingestion/findEligibleCompanySources";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedInternalRequest } from "@/lib/internalAuth";

// Internal, service-to-service endpoint: the "AI Job Agent / 01 Job
// Ingestion" n8n workflow calls this once per run to discover the current
// verified, automatable company_sources rows instead of relying on a
// hardcoded source list — see src/lib/ingestion/findEligibleCompanySources.ts
// for the exact eligibility criteria and docs/SOURCE_COVERAGE_AND_PROVIDER_EXPANSION_AUDIT.md
// (Phase 12) for the evidence this replaces. Every returned source's live
// review_status/automation_eligibility is still re-verified again, per
// source, inside runIngestionBatch() before anything is written — this
// endpoint's result is a discovery convenience, never trusted as
// authorization by itself.
export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request, "INGESTION_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const sources = await findEligibleCompanySources(supabase);
    // snake_case on the wire deliberately: this response is consumed only by
    // "AI Job Agent / 01 Job Ingestion", whose downstream nodes (Split Out
    // Sources, Extract Jobs By ATS Type, ...) already read source_id/ats_type/
    // feed_url — the exact shape the static source list this replaces used.
    // Matching it means zero downstream node changes, not a new API convention.
    return NextResponse.json({
      sources: sources.map((s) => ({ source_id: s.sourceId, ats_type: s.sourceType, feed_url: s.feedUrl })),
    });
  } catch (error) {
    console.error("list-sources failed:", error);
    return NextResponse.json({ error: "Failed to list eligible ingestion sources. See server logs." }, { status: 500 });
  }
}
