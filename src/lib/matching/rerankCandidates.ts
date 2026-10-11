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
import type { SupabaseClient } from "@supabase/supabase-js";
import { shortlistJobsForUser, type ShortlistUserContext } from "./shortlist.ts";
import { buildRerankPrompt, type RerankJobInput, type RerankProfileInput } from "./rerankPrompt.ts";
import type { PlanCode } from "@/lib/plans/types";
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

export function encodeCandidateId(cvAnalysisId: string, jobId: string): string {
  return `${cvAnalysisId}:${jobId}`;
}

export function decodeCandidateId(candidateId: string): { cvAnalysisId: string; jobId: string } | null {
  const separatorIndex = candidateId.indexOf(":");
  if (separatorIndex === -1) return null;
  return { cvAnalysisId: candidateId.slice(0, separatorIndex), jobId: candidateId.slice(separatorIndex + 1) };
}

// Extends the hard-eligibility context with fields the rerank LLM prompt
// needs but checkJobEligibility() itself has no use for (target roles/
// preferred locations/experience level are semantic signals, never a hard
// gate — see shortlist.ts/embeddingText.ts for where they actually matter).
// Kept as a local extension rather than widening ShortlistUserContext,
// which stays exactly "what hard eligibility needs," nothing more.
interface UserContext extends ShortlistUserContext {
  targetRoles: string[];
  preferredLocations: string[];
  experienceLevel: string | null;
}

async function loadUserContext(supabase: SupabaseClient, userId: string): Promise<UserContext> {
  const { data: subscription } = await supabase.from("subscriptions").select("plan_code").eq("user_id", userId).maybeSingle();
  const planCode = (subscription?.plan_code as PlanCode | undefined) ?? "free";

  const { data: preferences } = await supabase
    .from("job_preferences")
    .select(
      "id, work_arrangement, job_type, job_market_coverage, international_search_enabled, willing_to_relocate, experience_level, custom_target_roles, custom_locations, location, job_preference_target_roles(target_roles(name)), job_preference_locations(locations(name))"
    )
    .eq("user_id", userId)
    .maybeSingle();

  let relocationMarketCountryCodes: string[] = [];
  if (preferences?.id) {
    const { data: relocationRows } = await supabase
      .from("job_preference_relocation_locations")
      .select("locations(country_code)")
      .eq("job_preference_id", preferences.id);
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
    targetRoles: [...referenceRoleNames, ...customRoles],
    preferredLocations: [...referenceLocationNames, ...customLocations],
    experienceLevel: (preferences?.experience_level as string | null) ?? null,
  };
}

export async function findRerankCandidates(supabase: SupabaseClient, options: FindRerankCandidatesOptions): Promise<RerankCandidate[]> {
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
        candidateId: encodeCandidateId(analysis.id, jobId),
        cvAnalysisId: analysis.id,
        jobId,
        userId: analysis.user_id,
        prompt: buildRerankPrompt(profileInput, jobInput),
      });
    }
  }

  return candidates;
}
