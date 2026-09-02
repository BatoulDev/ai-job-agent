"use client";

import { useState } from "react";
import Dialog from "./Dialog";

// Approval calls the real confirm_cv_analysis() RPC (see
// src/lib/cvAnalysis/confirm.client.ts and
// src/app/api/cv-analysis/confirm/route.ts). On success the dialog closes
// itself immediately and hands the parent a message to show outside the
// (now closed) dialog via onApproved — see AiCareerProfileSection's
// approvedNotice state. On failure the dialog stays open with the error
// shown inline so the user can retry or cancel. While a request is in
// flight, both buttons are disabled and Escape/backdrop-click cannot close
// the dialog, so a slow network can't be raced into a duplicate submit.
//
// Automation 2 note: once a real matching-task queue exists, this dialog's
// confirm action should become a single atomic step that validates
// freshness, approves the profile, and creates/reuses the matching task —
// only at that point should the buttons change from Cancel/Approve Profile
// to Cancel/Start Matching. No such queue exists yet, so the label stays
// "Approve Profile" for now.
export default function ApproveProfileDialog({
  open,
  onClose,
  onConfirm,
  onApproved,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<{ ok: boolean; message?: string }>;
  onApproved: (message: string) => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorNotice(null);

    const result = await onConfirm();
    setIsSubmitting(false);

    if (result.ok) {
      setErrorNotice(null);
      onClose();
      onApproved(result.message ?? "Your profile has been approved.");
      return;
    }

    setErrorNotice(result.message ?? "Something went wrong. Please try again.");
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setErrorNotice(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} titleId="approve-profile-title">
      <h2 id="approve-profile-title" className="font-display text-xl font-semibold text-text">
        Approve your career profile?
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Once approved, this profile will be used for future job matching.
        You can still update your preferences or replace your CV later.
      </p>

      {errorNotice && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorNotice}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={handleClose}
          disabled={isSubmitting}
          className="flex-1 rounded-full border border-slate-200 py-2.5 text-sm font-semibold text-text transition-colors hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isSubmitting}
          className="flex-1 rounded-full bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Approving..." : "Approve Profile"}
        </button>
      </div>
    </Dialog>
  );
}
