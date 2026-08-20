"use client";

import { createClient } from "@/lib/supabase/client";
import type { PreferencesData } from "./PreferencesSection";
import CurrentCvCard, { type CvRecord } from "./cvProfile/CurrentCvCard";
import AiCareerProfileSection from "./cvProfile/AiCareerProfileSection";
import {
  deriveCvProfileState,
  type RequestChangesPayload,
} from "@/lib/cvAnalysis/profileState";
import type { CvAnalysis } from "@/lib/cvAnalysis/types";
import type { AnalysisTaskStatus, AnalysisTaskTrigger } from "@/lib/analysisTasks/types";
import { confirmCvAnalysisRequest } from "@/lib/cvAnalysis/confirm.client";

export type { CvRecord };

// Maps the RequestChanges reason to the API feedbackType and task trigger.
const REASON_TO_FEEDBACK_TYPE: Record<string, "cv_correction" | "recommendation_feedback" | "user_request"> = {
  incorrect_cv_information: "cv_correction",
  change_ai_recommendations: "recommendation_feedback",
  other: "user_request",
};

async function submitFeedback(
  payload: RequestChangesPayload
): Promise<{ ok: boolean; message?: string; trigger?: AnalysisTaskTrigger }> {
  const feedbackType = REASON_TO_FEEDBACK_TYPE[payload.reason];
  if (!feedbackType) {
    return { ok: false, message: "Unexpected change reason." };
  }

  let response: Response;
  try {
    response = await fetch("/api/cv-analysis/submit-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        analysisId: payload.analysisId,
        feedbackType,
        feedbackText: payload.feedback ?? "",
        affectedSection: payload.affectedSection,
      }),
    });
  } catch {
    return { ok: false, message: "Could not reach the server. Please try again." };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, message: "Unexpected response from server." };
  }

  if (!response.ok) {
    const errMsg =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : "Something went wrong. Please try again.";
    return { ok: false, message: errMsg };
  }

  const trigger =
    typeof data === "object" &&
    data !== null &&
    "trigger" in data &&
    typeof (data as { trigger: unknown }).trigger === "string"
      ? (data as { trigger: string }).trigger as AnalysisTaskTrigger
      : (feedbackType as AnalysisTaskTrigger);

  return { ok: true, trigger };
}

export default function CvProfileSection({
  cv,
  preferences,
  preferencesComplete,
  taskStatus,
  taskTrigger,
  taskLastError,
  analysis,
  onNavigateToPreferences,
  onAnalysisUpdated,
  onTaskStarted,
  updateStalled,
}: {
  cv: CvRecord | null;
  preferences: PreferencesData | null;
  preferencesComplete: boolean;
  taskStatus: AnalysisTaskStatus | null;
  taskTrigger: AnalysisTaskTrigger | null;
  taskLastError?: string | null;
  analysis: CvAnalysis | null;
  onNavigateToPreferences: () => void;
  onAnalysisUpdated: (analysis: CvAnalysis) => void;
  onTaskStarted: (trigger: AnalysisTaskTrigger) => void;
  updateStalled?: boolean;
}) {
  async function approveProfile(): Promise<{ ok: boolean; message?: string }> {
    if (!analysis) {
      return { ok: false, message: "No analysis available to approve." };
    }
    const result = await confirmCvAnalysisRequest(analysis.id);
    if (result.ok && result.analysis) {
      onAnalysisUpdated(result.analysis);
    }
    return {
      ok: result.ok,
      message: result.message ?? (result.ok ? "Your profile has been approved." : "Something went wrong. Please try again."),
    };
  }

  async function requestProfileChanges(
    payload: RequestChangesPayload
  ): Promise<{ ok: boolean; message?: string }> {
    const result = await submitFeedback(payload);
    if (result.ok && result.trigger) {
      onTaskStarted(result.trigger);
    }
    return { ok: result.ok, message: result.message };
  }

  const state = deriveCvProfileState({
    hasActiveCv: !!cv,
    preferencesComplete,
    task: taskStatus ? { status: taskStatus, last_error: taskLastError ?? null } : null,
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
        taskTrigger={taskTrigger}
        analysis={analysis}
        preferences={preferences}
        onApprove={approveProfile}
        onRequestChanges={requestProfileChanges}
        onNavigateToPreferences={onNavigateToPreferences}
        updateStalled={updateStalled}
      />
    </div>
  );
}
