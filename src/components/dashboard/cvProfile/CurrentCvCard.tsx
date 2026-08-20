"use client";

import { useState } from "react";
import Link from "next/link";
import type { CvProfileState } from "@/lib/cvAnalysis/profileState";

export interface CvRecord {
  id: string;
  fileName: string;
  fileSizeBytes: number | null;
  status: string;
  storagePath: string;
  createdAt: string;
}

const STATUS_LABELS: Record<CvProfileState, string> = {
  no_cv: "Uploaded",
  no_preferences: "Uploaded",
  analyzing: "Analyzing",
  ready_for_review: "Ready for review",
  approved: "Approved and active",
  preferences_outdated: "Update required",
  changes_requested: "Update required",
  ownership_mismatch: "Review required",
  failed: "Analysis failed",
};

const STATUS_STYLES: Record<CvProfileState, string> = {
  no_cv: "bg-slate-100 text-muted",
  no_preferences: "bg-slate-100 text-muted",
  analyzing: "bg-accent/10 text-accent",
  ready_for_review: "bg-primary/10 text-primary",
  approved: "bg-success/10 text-success",
  preferences_outdated: "bg-amber-100 text-amber-700",
  changes_requested: "bg-amber-100 text-amber-700",
  ownership_mismatch: "bg-amber-100 text-amber-700",
  failed: "bg-red-50 text-red-700",
};

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function CurrentCvCard({
  cv,
  state,
  onViewCv,
}: {
  cv: CvRecord | null;
  state: CvProfileState;
  onViewCv: () => Promise<void>;
}) {
  const [isViewLoading, setIsViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  const handleView = async () => {
    setViewError(null);
    setIsViewLoading(true);
    try {
      await onViewCv();
    } catch {
      setViewError("Couldn't open your CV right now. Please try again.");
    } finally {
      setIsViewLoading(false);
    }
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-card p-6 shadow-sm sm:p-8">
      <h2 className="font-display text-lg font-semibold text-text">Current CV</h2>

      {cv ? (
        <>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path
                    d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M14 3v5h5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-text">{cv.fileName}</p>
                <p className="mt-1 text-xs text-muted">
                  Uploaded {formatDate(cv.createdAt)}
                  {cv.fileSizeBytes ? ` · ${formatFileSize(cv.fileSizeBytes)}` : ""}
                </p>
              </div>
              <span
                className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[state]}`}
              >
                {STATUS_LABELS[state]}
              </span>
            </div>

            <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleView}
                disabled={isViewLoading}
                className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-text transition-colors hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isViewLoading ? "Opening..." : "View CV"}
              </button>
              <Link
                href="/onboarding/upload-cv"
                className="rounded-full bg-primary px-5 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
              >
                Replace CV
              </Link>
            </div>
          </div>

          {viewError && (
            <p role="alert" className="mt-3 text-xs text-red-700">
              {viewError}
            </p>
          )}
        </>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-bg px-6 py-8 text-center">
          <p className="text-sm text-muted">
            Upload your CV so your AI Job Agent can build your career
            profile and start matching you with roles.
          </p>
          <Link
            href="/onboarding/upload-cv"
            className="mt-4 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
          >
            Upload CV
          </Link>
        </div>
      )}
    </div>
  );
}
