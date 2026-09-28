// Discovery query for Tier-B career-page extraction candidates (Phase 13
// §4) — the automation_eligibility='suitable_public_html_subject_to_review'
// counterpart to findEligibleCompanySources.ts's 'suitable_public_ats'
// query. Every returned row is a real, human-verified company whose
// official_careers_url is worth fetching and running through
// extractCareerPageJobPostings.ts — whether that page actually yields any
// jobs depends on whether it emits schema.org JobPosting JSON-LD, which is
// re-discovered live every run, never assumed from a prior check.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CareerPageExtractionCandidate {
  sourceId: string;
  careersUrl: string;
}

// 260 registry rows in the 5 target markets alone carry this classification
// (Phase 16 count, up from the 358 registry-wide figure Phase 13 first
// measured) — fetching every one of them on every ingestion run would be an
// unbounded, unnecessarily heavy external fetch (AGENTS.md §26/§27) for a
// path whose real yield is still unproven (Phase 13: 0/11 sampled;
// Phase 14's real run: 14/20 succeeded with an honest 0 jobs found, 6/20
// failed on real site errors — see docs/INGESTION_REAL_E2E_VALIDATION.md
// §4). Raised from 20 to 50 this phase (Phase 16) — a real, evidence-based
// finding explains why more attempts alone won't fix the 0-yield problem:
// extractCareerPageJobPostings.ts only reads the one URL it's given, and
// real company career pages almost always put JobPosting JSON-LD on each
// job's own detail page, not the recorded landing page — see that file's
// own header and the one-level link-following extension added this phase
// (extract-career-page-jobs/route.ts) for the real fix. Still bounded and
// ordered by id for a stable, deterministic subset across runs — a future
// phase can add real rotation/pagination across the full 260-row pool once
// this path has a proven yield worth scaling further.
const DEFAULT_LIMIT = 50;

export async function findCareerPageExtractionCandidates(supabase: SupabaseClient, limit = DEFAULT_LIMIT): Promise<CareerPageExtractionCandidate[]> {
  const { data, error } = await supabase
    .from("company_sources")
    .select("id, official_careers_url")
    .eq("review_status", "verified")
    .eq("automation_eligibility", "suitable_public_html_subject_to_review")
    .not("official_careers_url", "is", null)
    .order("id")
    .limit(limit);
  if (error) throw new Error(`findCareerPageExtractionCandidates: query failed: ${error.message}`);

  return (data ?? [])
    .filter((row): row is { id: string; official_careers_url: string } => typeof row.official_careers_url === "string" && row.official_careers_url.trim().length > 0)
    .map((row) => ({ sourceId: row.id, careersUrl: row.official_careers_url }));
}
