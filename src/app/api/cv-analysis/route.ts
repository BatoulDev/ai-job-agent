import { NextResponse } from "next/server";
import { getCurrentCvAnalysisForReview, NotAuthenticatedError } from "@/lib/cvAnalysis/review";

// Returns the analysis the signed-in user should currently review — the
// most recent one tied to their active CV, or null if none exists yet
// (no CV uploaded, or no analysis has been produced for it — no worker
// exists yet in this phase). Always derives the user from the session;
// never accepts a user id or CV id from the client.
export async function GET() {
  try {
    const analysis = await getCurrentCvAnalysisForReview();
    return NextResponse.json({ analysis });
  } catch (error) {
    if (error instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    console.error("Failed to load CV analysis for review:", error);
    return NextResponse.json(
      { error: "Could not load your CV analysis. Please try again." },
      { status: 500 }
    );
  }
}
