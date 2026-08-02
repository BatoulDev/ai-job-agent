"use client";

import { createClient } from "@/lib/supabase/client";
import type { PreferencesData } from "./PreferencesSection";
import CurrentCvCard, { type CvRecord } from "./cvProfile/CurrentCvCard";
import AiCareerProfileSection from "./cvProfile/AiCareerProfileSection";
import {
  deriveCvProfileState,
  isPreferencesComplete,
  type RequestChangesPayload,
} from "@/lib/cvAnalysis/profileState";
import type { CvAnalysis } from "@/lib/cvAnalysis/types";
import type { AnalysisTaskStatus } from "@/lib/analysisTasks/types";

export type { CvRecord };

// No approval or revision backend endpoint exists yet — see
// DATABASE_PLAN.md's Phase 4B addendum ("Approval transaction
// (documented, not implemented)"). These two handlers are real,
// connected, and safe: they never write to the database or pretend an
// action succeeded. Once a real endpoint exists, only these two
// functions need to change — every dialog/component above already
// expects exactly this async { ok, message } contract.
async function approveProfile(): Promise<{ ok: boolean; message?: string }> {
  return {
    ok: false,
    message:
      "Approving isn't available yet — this will be enabled once profile approval is implemented on the backend.",
  };
}

async function requestProfileChanges(
  payload: RequestChangesPayload
): Promise<{ ok: boolean; message?: string }> {
  // Prepared for a future backend action — logged for local visibility
  // only, never persisted or claimed as submitted.
  console.info("[CV Profile] Request Changes payload (not yet submitted anywhere real):", payload);
  return {
    ok: false,
    message:
      "Submitting change requests isn't available yet — this will be enabled once the review endpoint is implemented on the backend.",
  };
}

export default function CvProfileSection({
  cv,
  preferences,
  taskStatus,
  analysis,
  onNavigateToPreferences,
}: {
  cv: CvRecord | null;
  preferences: PreferencesData | null;
  taskStatus: AnalysisTaskStatus | null;
  analysis: CvAnalysis | null;
  onNavigateToPreferences: () => void;
}) {
  const state = deriveCvProfileState({
    hasActiveCv: !!cv,
    preferencesComplete: isPreferencesComplete(preferences),
    task: taskStatus ? { status: taskStatus } : null,
    analysis: analysis
      ? {
          status: analysis.status,
          review_status: analysis.review_status,
          recommendations_state: analysis.recommendations_state,
        }
      : null,
  });

  const handleViewCv = async () => {
    if (!cv) return;
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("cvs")
      .createSignedUrl(cv.storagePath, 60);
    if (error || !data?.signedUrl) {
      throw error ?? new Error("No signed URL returned");
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-text sm:text-3xl">
          CV Profile
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
          Review your CV information, career preferences, and AI career
          recommendations before job matching begins.
        </p>
      </div>

      <CurrentCvCard cv={cv} state={state} onViewCv={handleViewCv} />

      <AiCareerProfileSection
        state={state}
        analysis={analysis}
        preferences={preferences}
        onApprove={approveProfile}
        onRequestChanges={requestProfileChanges}
        onNavigateToPreferences={onNavigateToPreferences}
      />
    </div>
  );
}
