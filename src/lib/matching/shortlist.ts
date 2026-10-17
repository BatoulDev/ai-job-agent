// Embedding shortlist (Phase 05): approved profile embedding + hard-eligible
// jobs -> a small, similarity-ranked candidate list for Phase 06's LLM
// rerank. Never calls an LLM — deterministic vector math + Phase 02's
// already-tested checkJobEligibility(), reused rather than re-derived
// (AGENTS.md §16 — one gate, not two that can drift).
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveEligibilityLocation, type JobLocationColumns } from "../ingestion/jobEligibilityLocation.ts";
import { checkJobEligibility, type JobEligibilityInput } from "../ingestion/checkJobEligibility.ts";
import { checkJobFreshness } from "./jobFreshness.ts";
import { cosineSimilarity } from "./cosineSimilarity.ts";

export type ShortlistUserContext = Omit<JobEligibilityInput, "job">;

export interface ShortlistedJob {
  jobId: string;
  similarity: number;
}

export interface ShortlistOptions {
  /** Bounded fetch of active, embedded jobs to consider (AGENTS.md §26 — never an unbounded query). */
  candidatePoolSize: number;
  /** How many of the eligible, ranked candidates to return for LLM rerank. */
  shortlistSize: number;
}

interface CandidateJobRow extends JobLocationColumns {
  id: string;
  embedding: number[] | null;
  published_at: string | null;
  last_seen_at: string | null;
  expires_at: string | null;
  closing_date: string | null;
  created_at: string;
}

/**
 * Fetches a bounded pool of recently-seen active jobs, applies Phase 02's
 * hard eligibility gate plus the freshness gate (jobFreshness.ts — catches
 * jobs whose source has stopped being re-crawled entirely, which status
 * alone does not yet express), then ranks the eligible subset by cosine
 * similarity to the user's profile embedding. Never calls an LLM — see
 * Phase 06 for that step, which only ever runs on this function's (small)
 * output.
 */
export async function shortlistJobsForUser(
  supabase: SupabaseClient,
  profileEmbedding: readonly number[],
  userContext: ShortlistUserContext,
  options: ShortlistOptions
): Promise<ShortlistedJob[]> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, location, country_code, city, work_arrangement, remote_scope, embedding, employment_type, published_at, last_seen_at, expires_at, closing_date, created_at")
    .eq("status", "active")
    .not("embedding", "is", null)
    .order("last_seen_at", { ascending: false })
    // Deterministic tiebreak: last_seen_at is nullable (and genuinely NULL
    // for every row that has never had its freshness tracked), so without a
    // secondary key, Postgres returns tied rows in an undefined, physically-
    // determined order that can vary between executions. created_at is
    // NOT NULL DEFAULT now() and strictly increases per insert, so this
    // never changes the ordering when last_seen_at actually differs — it
    // only makes the otherwise-arbitrary tie order reproducible, preferring
    // the more recently-created listing among equally-fresh/untracked jobs.
    .order("created_at", { ascending: false })
    .limit(options.candidatePoolSize);
  if (error) throw new Error(`shortlistJobsForUser: failed to fetch candidate jobs: ${error.message}`);

  const scored: ShortlistedJob[] = [];
  for (const job of (data ?? []) as CandidateJobRow[]) {
    if (!job.embedding) continue;

    const freshness = checkJobFreshness({
      publishedAt: job.published_at,
      lastSeenAt: job.last_seen_at,
      expiresAt: job.expires_at,
      closingDate: job.closing_date,
      createdAt: job.created_at,
    });
    if (!freshness.fresh) continue;

    const location = deriveEligibilityLocation({
      location: job.location,
      country_code: job.country_code,
      city: job.city,
      work_arrangement: job.work_arrangement,
      remote_scope: job.remote_scope,
      employment_type: job.employment_type,
    });
    const eligibility = checkJobEligibility({ job: location, ...userContext });
    if (!eligibility.eligible) continue;

    scored.push({ jobId: job.id, similarity: cosineSimilarity(profileEmbedding, job.embedding) });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, options.shortlistSize);
}
