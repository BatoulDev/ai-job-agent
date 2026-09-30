import { NextResponse } from "next/server";
import { findEligibleCompanySources } from "@/lib/ingestion/findEligibleCompanySources";
import { findCareerPageExtractionCandidates } from "@/lib/ingestion/findCareerPageExtractionCandidates";
import { getEnabledMultiCompanyFeedSources } from "@/lib/ingestion/multiCompanyFeedUrls";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedInternalRequest } from "@/lib/internalAuth";

// Internal, service-to-service endpoint: the "AI Job Guide / 01 Job
// Ingestion" n8n workflow calls this once per run to discover both (a) the
// current verified, automatable company_sources rows (Tier A/B — see
// findEligibleCompanySources.ts) and (b) the currently-enabled
// multi-company feed providers (Tier D, Phase 13 — see
// multiCompanyFeedUrls.ts), instead of relying on any hardcoded list. See
// docs/SOURCE_COVERAGE_AND_PROVIDER_EXPANSION_AUDIT.md (Phase 12) and
// docs/PROVIDER_EXPANSION_IMPLEMENTATION.md (Phase 13). Every returned
// company-specific source's live review_status/automation_eligibility is
// still re-verified again inside runIngestionBatch(), and every
// multi-company provider's enabled flag is re-verified again inside
// runMultiCompanyIngestionBatch() — this endpoint's result is a discovery
// convenience, never trusted as authorization by itself.
export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request, "INGESTION_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const [sources, careerPageCandidates] = await Promise.all([findEligibleCompanySources(supabase), findCareerPageExtractionCandidates(supabase)]);
    const multiCompanySources = getEnabledMultiCompanyFeedSources();
    // snake_case on the wire deliberately: this response is consumed only by
    // "AI Job Guide / 01 Job Ingestion", whose downstream nodes (Split Out
    // Sources, Extract Jobs By ATS Type, ...) already read source_id/ats_type/
    // feed_url — the exact shape the static source list this replaces used.
    // Matching it means minimal downstream node changes, not a new API
    // convention. multi_company_sources and career_page_candidates are new,
    // separate arrays (Phase 13).
    return NextResponse.json({
      sources: sources.map((s) => ({ source_id: s.sourceId, ats_type: s.sourceType, feed_url: s.feedUrl })),
      multi_company_sources: multiCompanySources.map((s) => ({ provider_type: s.sourceType, feed_url: s.feedUrl, paginated: s.paginated })),
      career_page_candidates: careerPageCandidates.map((c) => ({ source_id: c.sourceId, careers_url: c.careersUrl })),
    });
  } catch (error) {
    console.error("list-sources failed:", error);
    return NextResponse.json({ error: "Failed to list eligible ingestion sources. See server logs." }, { status: 500 });
  }
}
