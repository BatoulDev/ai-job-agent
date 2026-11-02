// Discovery query for the LLM rerank step (Phase 06): for every currently
// matching-eligible, embedded profile, compute its embedding shortlist
// (Phase 05) and build a grounded rerank prompt for whichever shortlisted
// jobs don't already have a matches row for that (user, analysis) pair —
// never re-scoring (and never re-spending an LLM call on) a job already
// scored for the same analysis.
//
// ponytail: several small sequential queries per candidate user (plan,
// preferences, relocation markets, job lookup) rather than one large SQL
// join — bounded by userLimit/jobsPerUser, fine at this product's real
// scale (a handful of users during the MVP). Upgrade to a single RPC-backed
// join if this is ever measured to be slow at real volume.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { shortlistJobsForUser, type ShortlistUserContext } from "./shortlist.ts";
import { buildRerankPrompt, type RerankJobInput, type RerankProfileInput } from "./rerankPrompt.ts";
import { signCandidateToken, verifyCandidateToken, type VerifyCandidateTokenResult } from "./candidateToken.ts";
// A relative import, not the "@/" alias other files here use for
// TYPE-ONLY references to this module (checkJobEligibility.ts) — isPlanCode
// is a real runtime value, and "@/" only resolves through the Next.js
// bundler, not under plain `node --test` (which these tests run under).
// A type-only import is fully erased before Node's module resolver ever
// sees it, which is why the alias worked for type-only imports elsewhere;
// a real value import cannot be erased the same way.
import { isPlanCode, type PlanCode } from "../plans/types.ts";
import type { JobMarketCoverage, JobType, WorkArrangement } from "@/lib/jobPreferences/types";

export interface RerankCandidate {
  /** Stable id for round-tripping through an external caller (n8n) — see save side, which parses this back apart. */
  candidateId: string;
  cvAnalysisId: string;
  jobId: string;
  userId: string;
  prompt: string;
}

export interface FindRerankCandidatesOptions {
  userLimit: number;
  jobsPerUser: number;
  candidatePoolSize: number;
}

// Checkpoint 2E: candidateId is now a versioned, HMAC-signed token
// (candidateToken.ts) — thin wrappers so every existing import of
// encodeCandidateId/decodeCandidateId (save-rerank-results/route.ts,
// tests/db/matching-rerank.test.mjs) keeps working against the same
// function names, with the contract strengthened rather than the call
// sites rewired. decodeCandidateId now returns the full
// VerifyCandidateTokenResult (ok + failure reason) instead of a bare
// nullable value — callers must distinguish WHY a token was rejected
// (requirement: invalid token vs. expired vs. ineligible vs. infra
// error), which a plain null could never express.
export function encodeCandidateId(cvAnalysisId: string, jobId: string, runId: string): string {
  return signCandidateToken({ cvAnalysisId, jobId, runId });
}

export function decodeCandidateId(candidateId: string): VerifyCandidateTokenResult {
  return verifyCandidateToken(candidateId);
}

// Extends the hard-eligibility context with fields the rerank LLM prompt
// needs but checkJobEligibility() itself has no use for (target roles/
// preferred locations/experience level are semantic signals, never a hard
// gate — see shortlist.ts/embeddingText.ts for where they actually matter).
// Kept as a local extension rather than widening ShortlistUserContext,
// which stays exactly "what hard eligibility needs," nothing more.
export interface UserContext extends ShortlistUserContext {
  targetRoles: string[];
  preferredLocations: string[];
  experienceLevel: string | null;
  /**
   * Work Authorization Phase 1: the user's own self-reported
   * job_preferences.work_authorization_status — advisory context for the
   * rerank prompt ONLY (rerankPrompt.ts), never read by
   * checkJobEligibility()/isJobEligibleGivenLocations(). Deliberately
   * kept on this local extension, not on ShortlistUserContext/
   * JobEligibilityInput, so it is structurally impossible for this field
   * to ever reach the deterministic eligibility gate by accident.
   */
  workAuthorizationStatus: string | null;
}

/**
 * Checkpoint 2E fix: a subscription row's plan_code alone is NOT
 * authoritative — expire_subscription/cancel_subscription
 * (20260802090010_create_subscriptions.sql) only ever flip `status` to
 * 'expired'/'cancelled'; neither resets plan_code back to 'free', and
 * neither function is called from anywhere in src/ (confirmed by search —
 * no automated expiry sweep exists), so `status` itself can also never
 * self-correct purely from current_period_end passing. Both signals are
 * checked independently: a non-'active' status, OR current_period_end
 * already in the past, both fall back to 'free' — never the stale paid
 * value, never a guess. isPlanCode narrows defensively rather than
 * trusting the DB's FK-constrained value with an unchecked cast.
 */
export function deriveEffectivePlanCode(
  subscription: { plan_code: string; status: string; current_period_end: string | null } | null | undefined
): PlanCode {
  if (!subscription) return "free";
  if (subscription.plan_code === "free") return "free";
  if (subscription.status !== "active") return "free";
  if (subscription.current_period_end) {
    const periodEndMs = new Date(subscription.current_period_end).getTime();
    // FIX (Checkpoint 2E audit finding): NaN <= anything is always false
    // in JavaScript, so an invalid/unparseable current_period_end value
    // previously fell through as if it were a valid, still-future date —
    // the opposite of fail-closed. Number.isFinite(NaN) is false, so this
    // now treats an unverifiable timestamp the same as an already-expired
    // one. A real Postgres timestamptz column shouldn't produce this, but
    // the check no longer depends on that assumption holding.
    if (!Number.isFinite(periodEndMs) || periodEndMs <= Date.now()) return "free";
  }
  return isPlanCode(subscription.plan_code) ? subscription.plan_code : "free";
}

/**
 * Exported (Checkpoint 2E) so save-time revalidation reloads the exact
 * same authoritative context discovery used — never a second, possibly-
 * drifting derivation. Every field here is read fresh on every call, no
 * caching — a plan downgrade, a relocation-market change, or a preference
 * edit between prepare-rerank and save-rerank-results is picked up simply
 * by calling this again.
 */
export async function loadUserContext(supabase: SupabaseClient, userId: string): Promise<UserContext> {
  // FIX (Checkpoint 2E audit finding): a query ERROR must never be
  // silently read as "no data" — the original code discarded `error` on
  // all three queries here, so a transient infrastructure failure would
  // resolve to the exact same defaults as a legitimate "no row exists"
  // case (free plan, no preferences). Both failed in the SAFE direction
  // (never grants extra eligibility) but masked a real failure as a real
  // business state. A genuinely missing row (data: null, error: null)
  // still correctly falls through to its existing default — only an
  // actual query error now throws.
  const { data: subscription, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select("plan_code, status, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (subscriptionError) throw new Error(`loadUserContext: failed to fetch subscription for user ${userId}: ${subscriptionError.message}`);
  const planCode = deriveEffectivePlanCode(subscription);

  // work_authorization_status added to this EXISTING query (Work
  // Authorization Phase 1) — the same authoritative, always-fresh
  // user-context load both discovery and save-time revalidation already
  // share, never a second/parallel query.
  const { data: preferences, error: preferencesError } = await supabase
    .from("job_preferences")
    .select(
      "id, work_arrangement, job_type, job_market_coverage, international_search_enabled, willing_to_relocate, work_authorization_status, experience_level, custom_target_roles, custom_locations, location, job_preference_target_roles(target_roles(name)), job_preference_locations(locations(name))"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (preferencesError) throw new Error(`loadUserContext: failed to fetch job_preferences for user ${userId}: ${preferencesError.message}`);

  let relocationMarketCountryCodes: string[] = [];
  if (preferences?.id) {
    const { data: relocationRows, error: relocationError } = await supabase
      .from("job_preference_relocation_locations")
      .select("locations(country_code)")
      .eq("job_preference_id", preferences.id);
    if (relocationError) {
      throw new Error(`loadUserContext: failed to fetch relocation markets for preference ${preferences.id}: ${relocationError.message}`);
    }
    const codes = (relocationRows ?? []).flatMap((row: { locations: { country_code: string } | { country_code: string }[] | null }) => {
      const locations = row.locations;
      if (!locations) return [];
      return Array.isArray(locations) ? locations.map((l) => l.country_code) : [locations.country_code];
    });
    relocationMarketCountryCodes = [...new Set(codes)];
  }

  // Reference-catalog selections + free-text custom entries are equally
  // valid — combined the same way embedProfile.ts and the cv-analysis-worker
  // already do, so the rerank prompt never silently drops whichever
  // selection method the user actually used. Supabase's untyped client
  // infers a nested-embed shape conservatively as an array at every level
  // (even though target_role_id/location_id are each a many-to-one FK, so
  // each child row really embeds a single related row at runtime) —
  // handled defensively to match either shape, same as embedProfile.ts.
  const namesFromEmbed = (embedded: { name: string }[] | { name: string } | null | undefined): string[] => {
    const rows = embedded == null ? [] : Array.isArray(embedded) ? embedded : [embedded];
    return rows.map((r) => r.name).filter((name): name is string => typeof name === "string" && name.length > 0);
  };
  const referenceRoleNames = (
    (preferences?.job_preference_target_roles as { target_roles: { name: string }[] | { name: string } | null }[] | undefined) ?? []
  ).flatMap((row) => namesFromEmbed(row.target_roles));
  const referenceLocationNames = (
    (preferences?.job_preference_locations as { locations: { name: string }[] | { name: string } | null }[] | undefined) ?? []
  ).flatMap((row) => namesFromEmbed(row.locations));
  const customRoles = ((preferences?.custom_target_roles as string[] | null) ?? []).filter((r) => r.length > 0);
  const customLocations = (preferences?.custom_locations as string[] | null) ?? (preferences?.location ? [preferences.location] : []);

  return {
    planCode,
    preferredWorkArrangement: (preferences?.work_arrangement as WorkArrangement | null) ?? null,
    preferredJobType: (preferences?.job_type as JobType | null) ?? null,
    jobMarketCoverage: (preferences?.job_market_coverage as JobMarketCoverage | null) ?? null,
    internationalSearchEnabled: preferences?.international_search_enabled ?? false,
    willingToRelocate: preferences?.willing_to_relocate ?? null,
    relocationMarketCountryCodes,
    workAuthorizationStatus: (preferences?.work_authorization_status as string | null) ?? null,
    targetRoles: [...referenceRoleNames, ...customRoles],
    preferredLocations: [...referenceLocationNames, ...customLocations],
    experienceLevel: (preferences?.experience_level as string | null) ?? null,
  };
}

export async function findRerankCandidates(supabase: SupabaseClient, options: FindRerankCandidatesOptions): Promise<RerankCandidate[]> {
  // One run identifier shared by every candidate token this call issues —
  // the "issuance context" a stateless signature binds to (Checkpoint 2E).
  const runId = randomUUID();

  const { data: analyses, error: analysesError } = await supabase
    .from("cv_analyses")
    .select("id, user_id, professional_summary, skills, recommended_roles, strongest_areas, profile_level, profile_embedding")
    .eq("review_status", "approved")
    .eq("is_current", true)
    .eq("recommendations_state", "current")
    .not("profile_embedding", "is", null)
    .limit(options.userLimit);
  if (analysesError) throw new Error(`findRerankCandidates: analyses query failed: ${analysesError.message}`);

  const candidates: RerankCandidate[] = [];

  for (const analysis of analyses ?? []) {
    const { data: eligible, error: eligibilityError } = await supabase.rpc("is_cv_analysis_matching_eligible", {
      p_analysis_id: analysis.id,
    });
    if (eligibilityError) throw new Error(`findRerankCandidates: eligibility check failed for ${analysis.id}: ${eligibilityError.message}`);
    if (!eligible) continue;

    const userContext = await loadUserContext(supabase, analysis.user_id);
    const shortlisted = await shortlistJobsForUser(supabase, analysis.profile_embedding as number[], userContext, {
      candidatePoolSize: options.candidatePoolSize,
      shortlistSize: options.jobsPerUser,
    });
    if (shortlisted.length === 0) continue;

    const shortlistedJobIds = shortlisted.map((s) => s.jobId);
    const { data: existingMatches, error: existingMatchesError } = await supabase
      .from("matches")
      .select("job_id")
      .eq("user_id", analysis.user_id)
      .eq("cv_analysis_id", analysis.id)
      .in("job_id", shortlistedJobIds);
    if (existingMatchesError) throw new Error(`findRerankCandidates: existing-matches query failed: ${existingMatchesError.message}`);
    const alreadyMatchedJobIds = new Set((existingMatches ?? []).map((m) => m.job_id));

    const profileInput: RerankProfileInput = {
      professionalSummary: analysis.professional_summary,
      skills: (analysis.skills as string[] | null) ?? [],
      recommendedRoles: (analysis.recommended_roles as string[] | null) ?? [],
      strongestAreas: (analysis.strongest_areas as string[] | null) ?? [],
      profileLevel: analysis.profile_level,
      preferredWorkArrangement: userContext.preferredWorkArrangement,
      preferredJobType: userContext.preferredJobType,
      targetRoles: userContext.targetRoles,
      preferredLocations: userContext.preferredLocations,
      experienceLevel: userContext.experienceLevel,
      willingToRelocate: userContext.willingToRelocate,
      workAuthorizationStatus: userContext.workAuthorizationStatus,
      relocationMarketCountryCodes: userContext.relocationMarketCountryCodes,
    };

    for (const { jobId } of shortlisted) {
      if (alreadyMatchedJobIds.has(jobId)) continue;

      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .select("title, description, company_name, location, work_arrangement, seniority, employment_type")
        .eq("id", jobId)
        .maybeSingle();
      if (jobError) throw new Error(`findRerankCandidates: job lookup failed for ${jobId}: ${jobError.message}`);
      if (!job) continue;

      const jobInput: RerankJobInput = {
        title: job.title,
        description: job.description,
        companyName: job.company_name,
        location: job.location,
        workArrangement: job.work_arrangement,
        seniority: job.seniority,
        employmentType: job.employment_type,
      };

      candidates.push({
        candidateId: encodeCandidateId(analysis.id, jobId, runId),
        cvAnalysisId: analysis.id,
        jobId,
        userId: analysis.user_id,
        prompt: buildRerankPrompt(profileInput, jobInput),
      });
    }
  }

  return candidates;
}
