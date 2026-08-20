import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { AnalysisTaskTrigger } from "@/lib/analysisTasks/types";

type FeedbackType = "cv_correction" | "recommendation_feedback" | "user_request";

const FEEDBACK_TYPES: Set<FeedbackType> = new Set([
  "cv_correction",
  "recommendation_feedback",
  "user_request",
]);

interface SubmitFeedbackBody {
  analysisId: string;
  feedbackType: FeedbackType;
  feedbackText: string;
  affectedSection?: string;
}

function parseBody(raw: unknown): SubmitFeedbackBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;

  const analysisId = b.analysisId;
  const feedbackType = b.feedbackType;
  const feedbackText = b.feedbackText;
  const affectedSection = b.affectedSection;

  if (typeof analysisId !== "string" || analysisId.length === 0) return null;
  if (typeof feedbackType !== "string" || !FEEDBACK_TYPES.has(feedbackType as FeedbackType)) return null;
  if (typeof feedbackText !== "string" || feedbackText.trim().length < 10) return null;
  if (affectedSection !== undefined && typeof affectedSection !== "string") return null;

  return {
    analysisId,
    feedbackType: feedbackType as FeedbackType,
    feedbackText,
    affectedSection: typeof affectedSection === "string" ? affectedSection : undefined,
  };
}

// Maps FeedbackType to the AnalysisTaskTrigger value created in the DB.
// Kept in sync with the analysis_tasks_trigger_check constraint
// (supabase/migrations/20260818100000_add_analysis_feedback.sql).
export function feedbackTypeToTrigger(type: FeedbackType): AnalysisTaskTrigger {
  return type; // they're identical strings by design
}

// POST /api/cv-analysis/submit-feedback
// Stores user correction/request feedback and creates (or deduplicates) the
// analysis re-run task in one atomic DB transaction via submit_analysis_feedback().
// The n8n worker reads the feedback row to include it in the AI prompt.
export async function POST(request: Request) {
  let body: SubmitFeedbackBody | null;
  try {
    body = parseBody(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body) {
    return NextResponse.json(
      {
        error:
          "analysisId (string), feedbackType (cv_correction | recommendation_feedback | user_request), " +
          "and feedbackText (≥10 chars) are required.",
      },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("submit_analysis_feedback", {
    p_analysis_id: body.analysisId,
    p_feedback_type: body.feedbackType,
    p_feedback_text: body.feedbackText,
    p_affected_section: body.affectedSection ?? null,
  });

  if (error) {
    if (error.message === "Analysis not found.") {
      return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
    }
    if (
      error.message.includes("Not authenticated") ||
      error.message.includes("permission denied")
    ) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    // Known validation outcomes from submit_analysis_feedback (e.g. "CV is no
    // longer active", "Feedback must be at least 10 characters") — safe to
    // surface directly without leaking internal details.
    if (
      error.message.includes("Feedback must") ||
      error.message.includes("Invalid feedback_type") ||
      error.message.includes("no longer active") ||
      error.message.includes("not exceed")
    ) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error("submit_analysis_feedback RPC error:", error.code, error.message);
    return NextResponse.json(
      { error: "Could not submit your feedback. Please try again." },
      { status: 500 }
    );
  }

  // Return the created feedback row + the trigger that the frontend can use
  // to immediately display the correct progress message.
  return NextResponse.json({
    feedback: data,
    trigger: feedbackTypeToTrigger(body.feedbackType) satisfies AnalysisTaskTrigger,
  });
}
