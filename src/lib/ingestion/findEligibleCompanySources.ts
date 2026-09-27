// Discovery query for the ingestion workflow's dynamic source list (Phase
// 12): every company_sources row that is (a) human-verified, (b) already
// classified by a researcher as automatable via a known public ATS, and (c)
// has a real, derivable Greenhouse/Lever/Workable feed URL. Replaces the
// n8n workflow's previous 4-item hardcoded "Static Pilot Source List" — see
// n8n-workflows/ai-job-agent-01-job-ingestion.ts's own "Known limitation"
// sticky note, which this closes.
//
// Deliberately conservative: review_status='verified' AND
// automation_eligibility='suitable_public_ats' are both required — the same
// two-condition gate ingestSourceBatch.ts's verifySourceForIngestion()
// re-checks live per-source anyway (defense in depth, not a new trust
// decision). A row that fails URL derivation is silently excluded, never
// guessed — see deriveAtsFeedUrl.ts's own docs for why that's a real
// ceiling, not a bug.
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveAtsFeedUrl } from "./deriveAtsFeedUrl.ts";
import type { JobSourceType } from "./rawProviderJob.ts";

export interface EligibleIngestionSource {
  sourceId: string;
  sourceType: Extract<JobSourceType, "greenhouse" | "lever" | "workable">;
  feedUrl: string;
}

export async function findEligibleCompanySources(supabase: SupabaseClient): Promise<EligibleIngestionSource[]> {
  const { data, error } = await supabase
    .from("company_sources")
    .select("id, ats_provider, official_careers_url")
    .eq("review_status", "verified")
    .eq("automation_eligibility", "suitable_public_ats");
  if (error) throw new Error(`findEligibleCompanySources: query failed: ${error.message}`);

  const sources: EligibleIngestionSource[] = [];
  for (const row of data ?? []) {
    const derived = deriveAtsFeedUrl(row.ats_provider, row.official_careers_url);
    if (!derived) continue;
    sources.push({ sourceId: row.id, sourceType: derived.sourceType, feedUrl: derived.feedUrl });
  }
  return sources;
}
