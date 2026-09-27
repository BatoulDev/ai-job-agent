"use client";

import { useState } from "react";
import type { CoverLetterRecord } from "@/lib/coverLetters/types";

export default function CoverLetterCard({
  matchId,
  coverLetter,
  onSaveEdit,
  onApprove,
}: {
  matchId: string;
  coverLetter: CoverLetterRecord | null;
  onSaveEdit: (coverLetterId: string, content: string) => Promise<void>;
  onApprove: (coverLetterId: string) => Promise<void>;
}) {
  const initialContent = coverLetter?.editedContent ?? coverLetter?.generatedContent ?? "";
  const [draft, setDraft] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!coverLetter || (coverLetter.generationStatus !== "completed" && coverLetter.approvalStatus !== "user_approved")) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-bg px-4 py-3 text-sm text-muted">
        Your cover letter for this job hasn&apos;t been drafted yet. Check back soon.
      </div>
    );
  }

  if (coverLetter.approvalStatus === "user_approved") {
    return (
      <div className="mt-4 rounded-2xl border border-slate-200 bg-bg p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Cover letter</span>
          <span className="inline-flex items-center rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">Approved</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text">{coverLetter.approvedContent}</p>
      </div>
    );
  }

  const handleSave = async () => {
    setError(null);
    setIsSaving(true);
    try {
      await onSaveEdit(coverLetter.id, draft);
    } catch {
      setError("Couldn't save your edit. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = async () => {
    setError(null);
    setIsApproving(true);
    try {
      await onApprove(coverLetter.id);
    } catch {
      setError("Couldn't approve this cover letter. Please try again.");
    } finally {
      setIsApproving(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-bg p-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Cover letter draft</span>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={8}
        className="mt-2 w-full rounded-xl border border-slate-200 bg-card p-3 text-sm leading-relaxed text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        aria-label={`Cover letter draft for match ${matchId}`}
      />
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || isApproving}
          className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-text transition-colors hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save Draft"}
        </button>
        <button
          type="button"
          onClick={handleApprove}
          disabled={isSaving || isApproving}
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isApproving ? "Approving..." : "Approve Cover Letter"}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
