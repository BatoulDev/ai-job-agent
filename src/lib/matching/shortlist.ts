// Embedding shortlist (Phase 05): approved profile embedding + hard-eligible
// jobs -> a small, similarity-ranked candidate list for Phase 06's LLM
// rerank. Never calls an LLM — deterministic vector math + Phase 02's
// already-tested checkJobEligibility(), reused rather than re-derived
// (AGENTS.md §16 — one gate, not two that can drift).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveEligibilityLocation,
  deriveEligibilityLocationForVerifiedRow,
  type JobLocationColumns,
  type VerifiedLocationRow,
} from "../ingestion/jobEligibilityLocation.ts";
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
 * Checkpoint 2D: one batched fetch of every verified job_locations row for
 * the whole candidate pool (never one query per job — AGENTS.md §26/§31,
 * "avoid N+1"). Grouped by job_id; a job with no rows here simply has no
 * entry in the returned Map — the caller's own fallback to the scalar
 * jobs.country_code/city path (deriveEligibilityLocation) covers that,
 * unchanged from before this checkpoint.
 *
 * Supabase/PostgREST silently truncates a `select` to the project's
 * configured max_rows (locally 1000, supabase/config.toml) rather than
 * erroring — a candidate pool large enough, with enough locations per job,
 * could in principle exceed that. Requesting an exact count alongside the
 * data and comparing it to the returned row count is what actually proves
 * the fetch wasn't truncated; never assumed from the request succeeding
 * without an error. Throws (never silently proceeds with a partial set) if
 * truncation is detected — evaluating eligibility against a job's known-
 * incomplete location set could wrongly reject a job whose only qualifying
 * location happened to fall outside the truncated page, which is worse
 * than failing the whole batch loudly.
 *
 * FIX (Checkpoint 2D safety review): `count` itself is also untrusted — an
 * absent/null count (the `Content-Range` header missing or stripped by an
 * intermediate proxy, a future client library change) must fail closed,
 * not be read as "nothing to validate." The original version only checked
 * `count !== null && rows.length !== count`, which silently skipped the
 * whole completeness check whenever `count` came back null — exactly the
 * "apparently complete but partial" case this function exists to catch.
 * `{ count: "exact" }` was explicitly requested; a response without one is
 * itself an anomaly, never a quiet pass-through.
 *
 * Exported (Checkpoint 2E) so save-time revalidation (revalidateJobEligibility.ts)
 * re-fetches a single job's CURRENT verified locations through this exact
 * same fail-closed function — never a second, looser read path.
 */
export async function fetchVerifiedLocationsByJobId(
  supabase: SupabaseClient,
  jobIds: readonly string[]
): Promise<Map<string, VerifiedLocationRow[]>> {
  const locationsByJobId = new Map<string, VerifiedLocationRow[]>();
  if (jobIds.length === 0) return locationsByJobId;

  const { data, error, count } = await supabase
    .from("job_locations")
    .select("job_id, country_code, location_confidence", { count: "exact" })
    .in("job_id", jobIds);
  if (error) throw new Error(`shortlistJobsForUser: failed to fetch job_locations: ${error.message}`);

  const rows = data ?? [];
  if (count === null) {
    throw new Error(
      `shortlistJobsForUser: job_locations fetch returned no exact count — refusing to evaluate eligibility against a location set of unverifiable completeness.`
    );
  }
  if (rows.length !== count) {
    throw new Error(
      `shortlistJobsForUser: job_locations fetch returned ${rows.length} of ${count} rows — refusing to evaluate eligibility against a partially loaded location set.`
    );
  }

  for (const row of rows as { job_id: string; country_code: string; location_confidence: string }[]) {
    const list = locationsByJobId.get(row.job_id) ?? [];
    list.push({ countryCode: row.country_code, locationConfidence: row.location_confidence as VerifiedLocationRow["locationConfidence"] });
    locationsByJobId.set(row.job_id, list);
  }
  return locationsByJobId;
}

/**
 * Checkpoint 2D's per-job eligibility decision, extracted (Checkpoint 2E)
 * so discovery (shortlistJobsForUser, below) and save-time revalidation
 * (revalidateJobEligibility.ts) share the exact same function rather than
 * two copies of the same "try every verified location, any pass wins"
 * logic that could drift apart. A job with verified job_locations rows is
 * eligible once ANY one of them independently passes every existing hard-
 * eligibility rule — never by combining favorable attributes across
 * locations (job_locations carries no work_arrangement/remote_scope of
 * its own; every call below pairs one location's country with the SAME
 * job-level fields, see deriveEligibilityLocationForVerifiedRow).
 * `.some()` short-circuits on the first pass. A job with zero verified
 * locations (legacy jobs, and country-less Remote jobs by design —
 * Checkpoint 2C) falls back to the original scalar jobs.country_code/city
 * path, byte-for-byte unchanged.
 */
export function isJobEligibleGivenLocations(
  job: JobLocationColumns,
  verifiedLocations: VerifiedLocationRow[] | undefined,
  userContext: ShortlistUserContext
): boolean {
  return verifiedLocations && verifiedLocations.length > 0
    ? verifiedLocations.some((row) => checkJobEligibility({ job: deriveEligibilityLocationForVerifiedRow(job, row), ...userContext }).eligible)
    : checkJobEligibility({ job: deriveEligibilityLocation(job), ...userContext }).eligible;
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

  const candidateJobs = (data ?? []) as CandidateJobRow[];
  const locationsByJobId = await fetchVerifiedLocationsByJobId(supabase, candidateJobs.map((job) => job.id));

  const scored: ShortlistedJob[] = [];
  for (const job of candidateJobs) {
    if (!job.embedding) continue;

    const freshness = checkJobFreshness({
      publishedAt: job.published_at,
      lastSeenAt: job.last_seen_at,
      expiresAt: job.expires_at,
      closingDate: job.closing_date,
      createdAt: job.created_at,
    });
    if (!freshness.fresh) continue;

    // The surrounding loop pushes at most one `scored` entry per job id
    // regardless of how many verified locations qualify — never one entry
    // per qualifying location.
    const verifiedLocations = locationsByJobId.get(job.id);
    if (!isJobEligibleGivenLocations(job, verifiedLocations, userContext)) continue;

    scored.push({ jobId: job.id, similarity: cosineSimilarity(profileEmbedding, job.embedding) });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, options.shortlistSize);
}
