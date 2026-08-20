"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Dialog from "./Dialog";
import type { RequestChangesPayload, RequestChangesReason } from "@/lib/cvAnalysis/profileState";

const MIN_FEEDBACK_LENGTH = 10;

interface ReasonOption {
  reason: RequestChangesReason;
  title: string;
  description: string;
}

const OPTIONS: ReasonOption[] = [
  {
    reason: "incorrect_cv_information",
    title: "Incorrect CV information",
    description:
      "A skill, education item, experience, project, language, or other CV detail was extracted incorrectly.",
  },
  {
    reason: "update_preferences",
    title: "Update my preferences",
    description:
      "I want to change my target roles, location, job type, work arrangement, experience level, or other preferences.",
  },
  {
    reason: "change_ai_recommendations",
    title: "Change AI recommendations",
    description:
      "My CV information is correct, but I want different recommended roles or career guidance.",
  },
  {
    reason: "cv_changed",
    title: "My CV has changed",
    description: "I have a newer CV with updated skills, projects, education, or experience.",
  },
  {
    reason: "other",
    title: "Something else",
    description: "Describe another issue with your career profile.",
  },
];

// Options that collect written feedback in this dialog. "update_preferences"
// and "cv_changed" instead navigate straight to their existing real pages —
// see the behavior note on each option above.
const FEEDBACK_REASONS: RequestChangesReason[] = [
  "incorrect_cv_information",
  "change_ai_recommendations",
  "other",
];

// No revision backend endpoint exists yet (see DATABASE_PLAN.md's Phase
// 4B addendum — the approval/review transaction is documented, not
// implemented). onSubmit is wired to a real handler, but that handler is
// explicitly honest about not being able to save anything yet.
export default function RequestChangesDialog({
  open,
  onClose,
  analysisId,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  analysisId: string;
  onSubmit: (payload: RequestChangesPayload) => Promise<{ ok: boolean; message?: string }>;
}) {
  const router = useRouter();
  const [selectedReason, setSelectedReason] = useState<RequestChangesReason | null>(null);
  const [affectedSection, setAffectedSection] = useState("");
  const [feedback, setFeedback] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const resetAndClose = () => {
    setSelectedReason(null);
    setAffectedSection("");
    setFeedback("");
    setValidationError(null);
    setNotice(null);
    onClose();
  };

  const handleSelect = (reason: RequestChangesReason) => {
    if (reason === "update_preferences") {
      resetAndClose();
      router.push("/onboarding/preferences");
      return;
    }
    if (reason === "cv_changed") {
      resetAndClose();
      router.push("/onboarding/upload-cv");
      return;
    }
    setSelectedReason(reason);
    setValidationError(null);
  };

  const handleSubmit = async () => {
    if (feedback.trim().length < MIN_FEEDBACK_LENGTH) {
      setValidationError(
        `Please add a few more details (at least ${MIN_FEEDBACK_LENGTH} characters) so we understand what to change.`
      );
      return;
    }

    const payload: RequestChangesPayload = {
      analysisId,
      reason: selectedReason as RequestChangesReason,
      affectedSection: affectedSection.trim() || undefined,
      feedback: feedback.trim(),
    };

    setIsSubmitting(true);
    setValidationError(null);
    const result = await onSubmit(payload);
    setIsSubmitting(false);

    if (result.ok) {
      // Close the dialog on success — the dashboard will immediately show
      // the trigger-specific progress state without a notice inside the dialog.
      resetAndClose();
    } else {
      setNotice(result.message ?? "Something went wrong. Please try again.");
    }
  };

  const selectedOption = OPTIONS.find((option) => option.reason === selectedReason);

  return (
    <Dialog open={open} onClose={resetAndClose} titleId="request-changes-title" maxWidthClassName="max-w-lg">
      <h2 id="request-changes-title" className="font-display text-xl font-semibold text-text">
        What would you like to change?
      </h2>

      {!selectedReason ? (
        <ul className="mt-5 space-y-2">
          {OPTIONS.map((option) => (
            <li key={option.reason}>
              <button
                type="button"
                onClick={() => handleSelect(option.reason)}
                className="w-full rounded-2xl border border-slate-200 p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <p className="text-sm font-semibold text-text">{option.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{option.description}</p>
              </button>
            </li>
          ))}
        </ul>
      ) : FEEDBACK_REASONS.includes(selectedReason) ? (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setSelectedReason(null)}
            className="text-sm font-medium text-primary hover:text-primary-dark"
          >
            &larr; Back
          </button>

          <p className="mt-3 text-sm font-semibold text-text">{selectedOption?.title}</p>

          {selectedReason === "incorrect_cv_information" && (
            <div className="mt-4">
              <label htmlFor="affected-section" className="mb-1.5 block text-sm font-medium text-text">
                Which section? <span className="font-normal text-muted">(optional)</span>
              </label>
              <input
                id="affected-section"
                type="text"
                value={affectedSection}
                onChange={(event) => setAffectedSection(event.target.value)}
                placeholder="e.g. Work experience, Skills, Education"
                className="w-full rounded-xl border border-slate-200 bg-bg px-4 py-2.5 text-sm text-text placeholder:text-muted/60 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
          )}

          <div className="mt-4">
            <label htmlFor="feedback" className="mb-1.5 block text-sm font-medium text-text">
              What should we know?
            </label>
            <textarea
              id="feedback"
              rows={4}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="Describe what's incorrect or what you'd like changed..."
              className="w-full resize-none rounded-xl border border-slate-200 bg-bg px-4 py-2.5 text-sm text-text placeholder:text-muted/60 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {validationError && (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {validationError}
            </p>
          )}

          {notice && (
            <p role="status" className="mt-4 rounded-xl bg-bg px-4 py-3 text-sm text-text">
              {notice}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={resetAndClose}
              className="flex-1 rounded-full border border-slate-200 py-2.5 text-sm font-semibold text-text transition-colors hover:border-slate-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex-1 rounded-full bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Submitting..." : "Submit"}
            </button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
