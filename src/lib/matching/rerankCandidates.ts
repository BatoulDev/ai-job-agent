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
import type { JobMarketCoverage, WorkArrangement } from "@/lib/jobPreferences/types";

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

async function loadUserContext(supabase: SupabaseClient, userId: string): Promise<ShortlistUserContext> {
  const { data: subscription } = await supabase.from("subscriptions").select("plan_code").eq("user_id", userId).maybeSingle();
  const planCode = (subscription?.plan_code as PlanCode | undefined) ?? "free";

  const { data: preferences } = await supabase
    .from("job_preferences")
    .select("id, work_arrangement, job_market_coverage, international_search_enabled, willing_to_relocate")
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

  return {
    planCode,
    preferredWorkArrangement: (preferences?.work_arrangement as WorkArrangement | null) ?? null,
    jobMarketCoverage: (preferences?.job_market_coverage as JobMarketCoverage | null) ?? null,
    internationalSearchEnabled: preferences?.international_search_enabled ?? false,
    willingToRelocate: preferences?.willing_to_relocate ?? null,
    relocationMarketCountryCodes,
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
