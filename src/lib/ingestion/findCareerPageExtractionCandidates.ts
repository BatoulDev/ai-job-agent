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

// 358 registry rows currently carry this classification (Phase 12 audit) —
// fetching every one of them on every ingestion run would be an unbounded,
// unnecessarily heavy external fetch (AGENTS.md §26/§27) for a path with
// no live-proven yield yet (see extractCareerPageJobPostings.test.mjs's
// header: 0 of 11 sampled real candidates emitted JobPosting JSON-LD on
// their recorded official_careers_url this phase). Bounded and ordered by
// id for a stable, deterministic subset across runs rather than a random
// sample — a future phase can add real pagination/rotation once this path
// has a proven yield worth scaling.
const DEFAULT_LIMIT = 20;

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
