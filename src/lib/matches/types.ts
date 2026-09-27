// Mirrors public.matches (supabase/migrations/20260809090040_create_matches.sql)
// joined with public.jobs via the get_my_matches RPC
// (supabase/migrations/20260928090010_add_get_my_matches_rpc.sql). Manually
// maintained, following this project's existing convention (see
// src/lib/cvAnalysis/types.ts) — check against database.types.ts's
// `get_my_matches` Returns shape after any future schema change.

export type MatchStatus = "pending_review" | "user_approved" | "user_rejected";

export interface MatchWithJob {
  id: string;
  score: number;
  strengths: string[];
  preferenceAlignment: string | null;
  explanation: string | null;
  missingSkills: string[];
  status: MatchStatus;
  matchingModel: string | null;
  decidedAt: string | null;
  createdAt: string;
  job: {
    id: string;
    title: string;
    companyName: string;
    location: string | null;
    workArrangement: string | null;
    employmentType: string | null;
    seniority: string | null;
    applicationMethod: string | null;
    applicationUrl: string | null;
    applicationEmail: string | null;
    sourceType: string;
    sourceUrl: string | null;
    status: string;
  };
}

// Raw shape of one row from the get_my_matches(p_status) RPC.
export interface GetMyMatchesRow {
  match_id: string;
  score: number;
  score_breakdown: unknown;
  explanation: string | null;
  missing_skills: unknown;
  match_status: string;
  matching_model: string | null;
  decided_at: string | null;
  created_at: string;
  job_id: string;
  job_title: string;
  job_company_name: string;
  job_location: string | null;
  job_work_arrangement: string | null;
  job_employment_type: string | null;
  job_seniority: string | null;
  job_application_method: string | null;
  job_application_url: string | null;
  job_application_email: string | null;
  job_source_type: string;
  job_source_url: string | null;
  job_status: string;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// score_breakdown is saved by saveMatchResult (src/lib/matching/saveMatch.ts)
// as { strengths: string[], preference_alignment: string } — validated
// defensively here since it round-trips through jsonb.
export function mapMatchRow(row: GetMyMatchesRow): MatchWithJob {
  const breakdown = row.score_breakdown;
  const strengths =
    typeof breakdown === "object" && breakdown !== null && isStringArray((breakdown as Record<string, unknown>).strengths)
      ? ((breakdown as Record<string, unknown>).strengths as string[])
      : [];
  const preferenceAlignment =
    typeof breakdown === "object" && breakdown !== null && typeof (breakdown as Record<string, unknown>).preference_alignment === "string"
      ? ((breakdown as Record<string, unknown>).preference_alignment as string)
      : null;

  return {
    id: row.match_id,
    score: row.score,
    strengths,
    preferenceAlignment,
    explanation: row.explanation,
    missingSkills: isStringArray(row.missing_skills) ? row.missing_skills : [],
    status: row.match_status as MatchStatus,
    matchingModel: row.matching_model,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    job: {
      id: row.job_id,
      title: row.job_title,
      companyName: row.job_company_name,
      location: row.job_location,
      workArrangement: row.job_work_arrangement,
      employmentType: row.job_employment_type,
      seniority: row.job_seniority,
      applicationMethod: row.job_application_method,
      applicationUrl: row.job_application_url,
      applicationEmail: row.job_application_email,
      sourceType: row.job_source_type,
      sourceUrl: row.job_source_url,
      status: row.job_status,
    },
  };
}
