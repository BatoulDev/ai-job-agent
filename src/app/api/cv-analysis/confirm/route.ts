import { NextResponse } from "next/server";
import { confirmCvAnalysis, NotAuthenticatedError, CvAnalysisNotFoundError } from "@/lib/cvAnalysis/review";

interface ConfirmRequestBody {
  analysisId: string;
}

function parseRequestBody(body: unknown): ConfirmRequestBody | null {
  if (typeof body !== "object" || body === null) return null;
  const analysisId = (body as Record<string, unknown>).analysisId;
  if (typeof analysisId !== "string" || analysisId.length === 0) return null;
  return { analysisId };
}

// Confirms (approves) the signed-in user's own CV analysis. This is the
// explicit confirmation step distinguishing AI-generated output from
// user-confirmed facts — see confirm_cv_analysis() in
// supabase/migrations/20260809090100_add_cv_analyses_review_confirm.sql
// for the full approval transaction (ownership check, status validation,
// active-CV check, and atomic supersession of any prior approved/current
// analysis). Idempotent: confirming an already-confirmed, still-current
// analysis is a safe no-op, not an error.
export async function POST(request: Request) {
  let body: ConfirmRequestBody | null;

  try {
    body = parseRequestBody(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body) {
    return NextResponse.json({ error: "analysisId (string) is required." }, { status: 400 });
  }

  try {
    const analysis = await confirmCvAnalysis(body.analysisId);
    return NextResponse.json({ analysis });
  } catch (error) {
    if (error instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (error instanceof CvAnalysisNotFoundError) {
      return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
    }

    // Known, expected validation outcomes from confirm_cv_analysis() (e.g.
    // "not ready to confirm", "no longer your active CV") — safe to
    // surface directly (AGENTS.md §6/§19).
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }

    console.error("Failed to confirm CV analysis:", error);
    return NextResponse.json(
      { error: "Could not confirm your CV analysis. Please try again." },
      { status: 500 }
    );
  }
}
