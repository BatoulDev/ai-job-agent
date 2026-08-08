import { NextResponse } from "next/server";
import {
  updateCvAnalysisReview,
  NotAuthenticatedError,
  CvAnalysisNotFoundError,
} from "@/lib/cvAnalysis/review";

interface ReviewRequestBody {
  analysisId: string;
  userEdits: Record<string, unknown> | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequestBody(body: unknown): ReviewRequestBody | null {
  if (!isPlainObject(body)) return null;
  if (typeof body.analysisId !== "string" || body.analysisId.length === 0) return null;

  const userEdits = body.userEdits;
  if (userEdits !== null && !isPlainObject(userEdits)) return null;

  return { analysisId: body.analysisId, userEdits: userEdits ?? null };
}

// Saves the signed-in user's edits to their own, not-yet-approved CV
// analysis. The server derives the user from the session and re-validates
// ownership/state inside update_cv_analysis_review() — this route never
// trusts a client-supplied user id, and never lets a client set
// review_status, reviewed_at, or any AI-generated column directly.
export async function POST(request: Request) {
  let body: ReviewRequestBody | null;

  try {
    body = parseRequestBody(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body) {
    return NextResponse.json(
      { error: "analysisId (string) and userEdits (object or null) are required." },
      { status: 400 }
    );
  }

  try {
    const analysis = await updateCvAnalysisReview(body.analysisId, body.userEdits);
    return NextResponse.json({ analysis });
  } catch (error) {
    if (error instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (error instanceof CvAnalysisNotFoundError) {
      return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
    }

    // Known, expected validation outcomes from update_cv_analysis_review()
    // (e.g. "not ready for review yet", "already been confirmed") — safe
    // to surface directly; the function never includes database internals
    // in its exception messages (AGENTS.md §6/§19).
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }

    console.error("Failed to update CV analysis review:", error);
    return NextResponse.json(
      { error: "Could not save your review. Please try again." },
      { status: 500 }
    );
  }
}
