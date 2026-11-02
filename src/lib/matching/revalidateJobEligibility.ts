// Checkpoint 2E: authoritative save-time re-check. prepare-rerank and
// save-rerank-results can be minutes apart for a candidate near the end
// of a real sequential n8n run (ai-job-agent-02-job-matching.ts) — a job
// can go unavailable, lose its qualifying verified location, or the
// user's plan/relocation markets can change in that window. This module
// re-derives the exact same discovery-time decision against CURRENT data
// immediately before a match is persisted — it reuses
// isJobEligibleGivenLocations/fetchVerifiedLocationsByJobId (Checkpoint
// 2D) verbatim, never a second eligibility rule implementation.
//
// Fails closed: any database read failure throws, rather than returning
// an "eligible" default — the caller (save-rerank-results/route.ts) must
// treat a failed revalidation as "do not save," never as "probably fine."
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchVerifiedLocationsByJobId, isJobEligibleGivenLocations, type ShortlistUserContext } from "./shortlist.ts";
import { checkJobFreshness } from "./jobFreshness.ts";
import type { JobLocationColumns } from "../ingestion/jobEligibilityLocation.ts";

export type RevalidationFailureReason = "job_not_found" | "job_not_active" | "job_not_fresh" | "job_not_eligible";

export type RevalidateJobEligibilityResult = { eligible: true } | { eligible: false; reason: RevalidationFailureReason };

export async function revalidateJobEligibilityForSave(
  supabase: SupabaseClient,
  jobId: string,
  userContext: ShortlistUserContext
): Promise<RevalidateJobEligibilityResult> {
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select(
      "id, status, location, country_code, city, work_arrangement, remote_scope, employment_type, published_at, last_seen_at, expires_at, closing_date, created_at"
    )
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) throw new Error(`revalidateJobEligibilityForSave: failed to fetch job ${jobId}: ${jobError.message}`);
  if (!job) return { eligible: false, reason: "job_not_found" };

  // Not covered by checkJobEligibility itself — that function has no
  // concept of `status` (shortlistJobsForUser normally enforces this via
  // its own `.eq("status", "active")` WHERE clause, which a direct by-id
  // fetch here bypasses). A job closed/stale-closed/pending_review since
  // discovery must never be savable as a passing match.
  if (job.status !== "active") return { eligible: false, reason: "job_not_active" };

  const freshness = checkJobFreshness({
    publishedAt: job.published_at,
    lastSeenAt: job.last_seen_at,
    expiresAt: job.expires_at,
    closingDate: job.closing_date,
    createdAt: job.created_at,
  });
  if (!freshness.fresh) return { eligible: false, reason: "job_not_fresh" };

  const locationsByJobId = await fetchVerifiedLocationsByJobId(supabase, [jobId]);
  const verifiedLocations = locationsByJobId.get(jobId);
  const eligible = isJobEligibleGivenLocations(job as JobLocationColumns, verifiedLocations, userContext);
  return eligible ? { eligible: true } : { eligible: false, reason: "job_not_eligible" };
}
