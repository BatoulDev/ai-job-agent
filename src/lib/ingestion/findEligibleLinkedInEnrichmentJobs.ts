// Discovery query for the LinkedIn enrichment orchestration pass: which
// already-persisted LinkedIn jobs still need a data-slayer exact-ID call.
// Mirrors findEligibleCompanySources.ts's role for Tier A/B — a discovery
// convenience for the orchestrator to avoid an unnecessary paid call, NOT
// a second source of truth: applyLinkedInEnrichmentBatch.ts's own
// isEligibleForEnrichment re-check (linkedinEnrichment.ts) is what's
// actually authoritative, re-verified live per job on every apply call.
//
// Bounded to ENRICHMENT_BATCH_SIZE by default — one call returns at most
// one batch's worth of work. If more jobs are eligible than that, they
// are picked up by a later run, never all requested at once (Phase 12 —
// never send hundreds of ids in one actor run).
import type { SupabaseClient } from "@supabase/supabase-js";
import { ENRICHMENT_BATCH_SIZE, MAX_ENRICHMENT_ATTEMPTS } from "./linkedinEnrichment.ts";

export interface EligibleLinkedInEnrichmentJob {
  externalId: string;
}

export async function findEligibleLinkedInEnrichmentJobs(
  supabase: SupabaseClient,
  limit: number = ENRICHMENT_BATCH_SIZE
): Promise<EligibleLinkedInEnrichmentJob[]> {
  const { data, error } = await supabase
    .from("jobs")
    .select("external_id")
    .eq("source_type", "linkedin")
    .eq("dedup_scope", "type:linkedin")
    .is("work_arrangement", null)
    .lt("linkedin_enrichment_attempts", MAX_ENRICHMENT_ATTEMPTS)
    // Oldest-touched first — a reasonable, deterministic default so a
    // steady stream of newly-discovered jobs doesn't perpetually starve
    // older still-unresolved ones.
    .order("last_seen_at", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`findEligibleLinkedInEnrichmentJobs: query failed: ${error.message}`);

  return (data ?? [])
    .map((row) => row.external_id as string | null)
    .filter((externalId): externalId is string => typeof externalId === "string" && externalId.length > 0)
    .map((externalId) => ({ externalId }));
}
