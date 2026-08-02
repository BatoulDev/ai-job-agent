"use client";

import { useState } from "react";
import Dialog from "./Dialog";

// No approval backend endpoint exists yet (see DATABASE_PLAN.md's Phase
// 4B "Approval transaction (documented, not implemented)"). This dialog
// is fully built and wired to a real handler, but that handler is
// explicitly honest about not being able to save anything yet — it must
// never flip local state to pretend review_status became "approved".
export default function ApproveProfileDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<{ ok: boolean; message?: string }>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setNotice(null);
    const result = await onConfirm();
    setIsSubmitting(false);
    setNotice(
      result.message ??
        (result.ok
          ? "Approved."
          : "Approving isn't available yet — this will be enabled in a future update.")
    );
  };

  const handleClose = () => {
    setNotice(null);
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

      {notice && (
        <p role="status" className="mt-4 rounded-xl bg-bg px-4 py-3 text-sm text-text">
          {notice}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={handleClose}
          className="flex-1 rounded-full border border-slate-200 py-2.5 text-sm font-semibold text-text transition-colors hover:border-slate-300"
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
