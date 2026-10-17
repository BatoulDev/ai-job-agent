// Matching-time freshness gate — complements, never duplicates, the three
// status-transition mechanisms already documented in
// docs/PRODUCT_MATCHING_RULES.md "Job lifecycle": (1) ingestSourceBatch.ts's
// source-refresh stale-close, (2) expire_due_jobs()'s expires_at/
// closing_date sweep (prepared, not yet scheduled — see
// n8n-workflows/job-expiry-sweep.ts), (3) explicit provider-closed-text
// detection (deferred). All three require some ongoing signal (a fresh
// ingestion run, a populated deadline, or a close-text crawl) to ever fire.
// None of them fires for a job whose source has simply stopped being
// re-crawled at all (confirmed real gap: LinkedIn has no discovery branch
// wired into the ingestion workflow yet, so a persisted LinkedIn job is
// never re-confirmed by anything; and any other source that is disabled,
// paused, or broken leaves its last-ingested rows status='active' forever).
// That job still passes every existing check and would reach the
// embedding/rerank pipeline.
//
// This function is a read-time-only, status-column-untouched safety net for
// exactly that gap: never writes to the database, never mass-expires
// anything (an outage simply means fewer jobs pass this check during the
// outage; the moment the source is reconfirmed, last_seen_at updates and the
// job is normal again — no backfill/recovery needed). Mirrors
// checkJobEligibility.ts's shape and call site (shortlist.ts calls both,
// before similarity ranking/rerank).
//
// Thresholds (evidence-based, see this task's own pilot audit — not a blind
// 30-day guess): RECENT_CONFIRMATION_WINDOW_DAYS=21 covers the real n8n
// daily-ingestion cadence plus several missed cycles/a short outage, without
// penalizing the real "evergreen" Workable/Greenhouse postings this
// project's own local data shows staying active 60-90+ days while still
// being reconfirmed on every run. FALLBACK_PUBLISHED_WINDOW_DAYS=45 is used
// only when last_seen_at itself is absent (no reconfirmation signal exists
// at all) — wider than the confirmed window since it is the only evidence
// available, but still bounded well below the real outliers found (some
// unconfirmed rows were 300-468 days old by published_at).
export const RECENT_CONFIRMATION_WINDOW_DAYS = 21;
export const FALLBACK_PUBLISHED_WINDOW_DAYS = 45;

export interface JobFreshnessInput {
  publishedAt: string | null;
  lastSeenAt: string | null;
  expiresAt: string | null;
  closingDate: string | null;
  /** NOT NULL in the schema (default now()) — final fallback only, for a row with neither publishedAt nor lastSeenAt (e.g. a freshly admin-entered job, which never goes through ingestion's last_seen_at stamping). */
  createdAt: string;
}

export type JobFreshnessReason =
  | "fresh_confirmed"
  | "fresh_published_fallback"
  | "stale_unconfirmed"
  | "expired"
  | "closing_date_passed";

export interface JobFreshnessResult {
  fresh: boolean;
  reason: JobFreshnessReason;
}

function daysSince(isoTimestamp: string, now: Date): number {
  return (now.getTime() - new Date(isoTimestamp).getTime()) / 86_400_000;
}

/**
 * Pure, deterministic. Caller is responsible for the status='active' gate
 * (shortlist.ts's own SQL filter) — this only adds the time-based check
 * status alone cannot yet express. Does not read or write `status`.
 */
export function checkJobFreshness(input: JobFreshnessInput, now: Date = new Date()): JobFreshnessResult {
  // Defense in depth, same exact condition as expire_due_jobs() (migration
  // 20260930160000) — currently never populated by any adapter (real
  // finding, 0/508 local rows), but if a future adapter or admin entry ever
  // sets either, matching must respect it immediately, not wait for the
  // (still-unscheduled) hourly sweep to flip status first.
  if (input.expiresAt && new Date(input.expiresAt).getTime() <= now.getTime()) {
    return { fresh: false, reason: "expired" };
  }
  if (input.closingDate && new Date(input.closingDate).getTime() <= now.getTime()) {
    return { fresh: false, reason: "closing_date_passed" };
  }

  if (input.lastSeenAt) {
    return daysSince(input.lastSeenAt, now) <= RECENT_CONFIRMATION_WINDOW_DAYS
      ? { fresh: true, reason: "fresh_confirmed" }
      : { fresh: false, reason: "stale_unconfirmed" };
  }

  // No reconfirmation signal at all — fall back to the original posting
  // age (principle: posted_at is a fallback only when a stronger signal
  // does not exist, never a rescue when one exists but is unfavorable).
  if (input.publishedAt) {
    return daysSince(input.publishedAt, now) <= FALLBACK_PUBLISHED_WINDOW_DAYS
      ? { fresh: true, reason: "fresh_published_fallback" }
      : { fresh: false, reason: "stale_unconfirmed" };
  }

  // Neither signal exists (e.g. a directly admin-entered job, which never
  // goes through ingestion's last_seen_at stamping and may have no stated
  // original posting date either) — fall back to when this row itself
  // entered our system, same bound as the published_at fallback. Not
  // "unknown": created_at is NOT NULL, so this is still real evidence.
  return daysSince(input.createdAt, now) <= FALLBACK_PUBLISHED_WINDOW_DAYS
    ? { fresh: true, reason: "fresh_published_fallback" }
    : { fresh: false, reason: "stale_unconfirmed" };
}
