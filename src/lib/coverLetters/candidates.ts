// Discovery query for the cover-letter generation step (Phase 08): every
// approved match that doesn't yet have a cover_letters row gets a grounded
// prompt built from its own profile, job, and match-explanation data. A
// match_id uniquely identifies the (user, job, analysis) triple already, so
// — unlike Phase 06's rerank candidates — no compound candidate id is
// needed. Same retry story as Phase 06's rerank: a failed generation attempt
// (OpenAI error, invalid response) simply never writes a row, so the match
// is naturally re-offered as a candidate on the next run — no separate
// 'failed' bookkeeping needed.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCoverLetterPrompt, type CoverLetterJobInput, type CoverLetterMatchInput, type CoverLetterProfileInput } from "./prompt.ts";

export interface CoverLetterCandidate {
  matchId: string;
  prompt: string;
}

export async function findCoverLetterCandidates(supabase: SupabaseClient, limit: number): Promise<CoverLetterCandidate[]> {
  const { data: matches, error: matchesError } = await supabase
    .from("matches")
    .select("id, job_id, cv_analysis_id, explanation, score_breakdown")
    .eq("status", "user_approved")
    .limit(limit);
  if (matchesError) throw new Error(`findCoverLetterCandidates: matches query failed: ${matchesError.message}`);
  if (!matches || matches.length === 0) return [];

  const matchIds = matches.map((m) => m.id);
  const { data: existingLetters, error: lettersError } = await supabase.from("cover_letters").select("match_id").in("match_id", matchIds);
  if (lettersError) throw new Error(`findCoverLetterCandidates: cover_letters query failed: ${lettersError.message}`);

  const matchIdsWithLetters = new Set((existingLetters ?? []).map((row) => row.match_id));
  const pending = matches.filter((m) => !matchIdsWithLetters.has(m.id));
  if (pending.length === 0) return [];

  const candidates: CoverLetterCandidate[] = [];

  for (const match of pending) {
    const { data: analysis, error: analysisError } = await supabase
      .from("cv_analyses")
      .select("professional_summary, skills, strongest_areas, profile_level")
      .eq("id", match.cv_analysis_id)
      .maybeSingle();
    if (analysisError) throw new Error(`findCoverLetterCandidates: analysis lookup failed for ${match.cv_analysis_id}: ${analysisError.message}`);
    if (!analysis) continue;

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("title, description, company_name, location, work_arrangement")
      .eq("id", match.job_id)
      .maybeSingle();
    if (jobError) throw new Error(`findCoverLetterCandidates: job lookup failed for ${match.job_id}: ${jobError.message}`);
    if (!job) continue;

    const profileInput: CoverLetterProfileInput = {
      professionalSummary: analysis.professional_summary,
      skills: (analysis.skills as string[] | null) ?? [],
      strongestAreas: (analysis.strongest_areas as string[] | null) ?? [],
      profileLevel: analysis.profile_level,
    };
    const jobInput: CoverLetterJobInput = {
      title: job.title,
      description: job.description,
      companyName: job.company_name,
      location: job.location,
      workArrangement: job.work_arrangement,
    };
    const breakdown = match.score_breakdown as { strengths?: unknown } | null;
    const strengths = Array.isArray(breakdown?.strengths) ? (breakdown.strengths as string[]) : [];
    const matchInput: CoverLetterMatchInput = { explanation: match.explanation, strengths };

    candidates.push({
      matchId: match.id,
      prompt: buildCoverLetterPrompt(profileInput, jobInput, matchInput),
    });
  }

  return candidates;
}
