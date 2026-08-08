import { createClient } from "@/lib/supabase/server";
import type { CvAnalysis } from "./types";

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "NotAuthenticatedError";
  }
}

// Raised when the requested analysis doesn't exist, or exists but isn't
// visible under the session's own RLS-permitted rows — the two cases are
// deliberately not distinguished in the response, so a request for another
// user's analysis id reveals nothing about whether that id exists.
export class CvAnalysisNotFoundError extends Error {
  constructor() {
    super("Analysis not found");
    this.name = "CvAnalysisNotFoundError";
  }
}

// The analysis a user should currently review: the most recent one tied to
// their active CV. Only their own row is ever reachable — cv_analyses'
// only RLS policy for authenticated is select-own (see
// supabase/migrations/20260804090010_create_cv_analyses.sql).
export async function getCurrentCvAnalysisForReview(): Promise<CvAnalysis | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new NotAuthenticatedError();
  }

  const { data: activeCv, error: cvError } = await supabase
    .from("cvs")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (cvError) {
    throw new Error(`Failed to load active CV: ${cvError.message}`);
  }
  if (!activeCv) {
    return null;
  }

  const { data: analysis, error: analysisError } = await supabase
    .from("cv_analyses")
    .select("*")
    .eq("cv_id", activeCv.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (analysisError) {
    throw new Error(`Failed to load CV analysis: ${analysisError.message}`);
  }

  return (analysis as CvAnalysis | null) ?? null;
}

// Saves the user's review edits. Wraps update_cv_analysis_review(), which
// re-derives auth.uid() itself and rejects an analysis that isn't
// completed, isn't the caller's own, or is already approved — see
// supabase/migrations/20260809090100_add_cv_analyses_review_confirm.sql.
export async function updateCvAnalysisReview(
  analysisId: string,
  userEdits: Record<string, unknown> | null
): Promise<CvAnalysis> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new NotAuthenticatedError();
  }

  const { data, error } = await supabase.rpc("update_cv_analysis_review", {
    p_analysis_id: analysisId,
    p_user_edits: userEdits,
  });

  if (error) {
    if (error.message === "Analysis not found.") {
      throw new CvAnalysisNotFoundError();
    }
    throw new Error(error.message);
  }

  return data as CvAnalysis;
}

// Confirms (approves) the analysis. Wraps confirm_cv_analysis() — the
// approval transaction documented in DATABASE_PLAN.md's Phase 4A addendum
// and implemented in
// supabase/migrations/20260809090100_add_cv_analyses_review_confirm.sql.
// Idempotent: confirming an already-confirmed, still-current analysis is a
// safe no-op.
export async function confirmCvAnalysis(analysisId: string): Promise<CvAnalysis> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new NotAuthenticatedError();
  }

  const { data, error } = await supabase.rpc("confirm_cv_analysis", {
    p_analysis_id: analysisId,
  });

  if (error) {
    if (error.message === "Analysis not found.") {
      throw new CvAnalysisNotFoundError();
    }
    throw new Error(error.message);
  }

  return data as CvAnalysis;
}
