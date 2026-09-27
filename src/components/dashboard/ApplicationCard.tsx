"use client";

import { useState } from "react";
import { buildApplicationPreview, type ApplicationPreview } from "@/lib/applications/preview";
import type { MatchWithJob } from "@/lib/matches/types";
import type { CoverLetterRecord } from "@/lib/coverLetters/types";
import type { ApplicationRecord, ApplicationStatus } from "@/lib/applications/types";

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending_send: "Pending",
  sending: "Sending...",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_STYLES: Record<ApplicationStatus, string> = {
  pending_send: "bg-slate-100 text-muted",
  sending: "bg-accent/10 text-accent",
  sent: "bg-success/10 text-success",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-slate-100 text-muted",
};

function ExistingApplication({
  match,
  application,
  onMarkSent,
}: {
  match: MatchWithJob;
  application: ApplicationRecord;
  onMarkSent: (applicationId: string) => Promise<void>;
}) {
  const [isMarking, setIsMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMarkSent = async () => {
    setError(null);
    setIsMarking(true);
    try {
      await onMarkSent(application.id);
    } catch {
      setError("Couldn't update this application. Please try again.");
    } finally {
      setIsMarking(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-bg p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Application</span>
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[application.status]}`}>
          {STATUS_LABELS[application.status]}
        </span>
      </div>

      {application.applicationMethod === "external_link" && application.status === "pending_send" && (
        <>
          <p className="mt-2 text-sm text-muted">
            Your materials are ready.{" "}
            <a href={match.job.applicationUrl ?? "#"} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">
              Open the application link
            </a>{" "}
            to apply on the company&apos;s site.
          </p>
          <button
            type="button"
            onClick={handleMarkSent}
            disabled={isMarking}
            className="mt-3 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-text transition-colors hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isMarking ? "Saving..." : "I've applied — mark as sent"}
          </button>
          {error && (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {error}
            </p>
          )}
        </>
      )}
      {application.applicationMethod === "external_link" && application.status === "sent" && (
        <p className="mt-2 text-sm text-muted">You marked this as applied. Track what happens next from the Sent tab.</p>
      )}
      {application.applicationMethod === "email" && application.status === "sent" && (
        <p className="mt-2 text-sm text-muted">Sent to {match.job.applicationEmail}.</p>
      )}
      {application.applicationMethod === "email" && application.status === "pending_send" && (
        <p className="mt-2 text-sm text-muted">Waiting to be sent to {match.job.applicationEmail}.</p>
      )}
      {application.applicationMethod === "email" && application.status === "sending" && (
        <p className="mt-2 text-sm text-muted">Sending to {match.job.applicationEmail} now...</p>
      )}
      {application.status === "failed" && (
        <p className="mt-2 text-xs text-red-700">{application.lastError ?? "The send attempt failed."}</p>
      )}
    </div>
  );
}

function PreviewAndApprove({
  preview,
  isSubmitting,
  error,
  onApprove,
}: {
  preview: Exclude<ApplicationPreview, { blocked: true }>;
  isSubmitting: boolean;
  error: string | null;
  onApprove: () => void;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-bg p-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Application preview</span>
      {preview.method === "external_link" ? (
        <p className="mt-2 text-sm text-text">
          You&apos;ll apply directly via{" "}
          <a href={preview.applyUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">
            the job&apos;s application page
          </a>
          .
        </p>
      ) : (
        <div className="mt-2 space-y-2 text-sm text-text">
          <p>
            <span className="font-semibold">To:</span> {preview.recipientEmail}
          </p>
          <p>
            <span className="font-semibold">Subject:</span> {preview.subject}
          </p>
          <p className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-card p-3 text-xs leading-relaxed text-muted">{preview.body}</p>
        </div>
      )}
      <button
        type="button"
        onClick={onApprove}
        disabled={isSubmitting}
        className="mt-3 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Preparing..." : "Approve & Send Application"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export default function ApplicationCard({
  match,
  coverLetter,
  application,
  onApproveAndSend,
  onMarkSent,
}: {
  match: MatchWithJob;
  coverLetter: CoverLetterRecord | null;
  application: ApplicationRecord | null;
  onApproveAndSend: (matchId: string) => Promise<void>;
  onMarkSent: (applicationId: string) => Promise<void>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (application) {
    return <ExistingApplication match={match} application={application} onMarkSent={onMarkSent} />;
  }

  let preview: ApplicationPreview;
  try {
    preview = buildApplicationPreview(
      {
        title: match.job.title,
        companyName: match.job.companyName,
        applicationMethod: match.job.applicationMethod === "email" ? "email" : "external_link",
        applicationUrl: match.job.applicationUrl,
        applicationEmail: match.job.applicationEmail,
      },
      coverLetter ? { approvalStatus: coverLetter.approvalStatus, approvedContent: coverLetter.approvedContent } : null
    );
  } catch {
    return null;
  }

  if (preview.blocked) {
    return <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-bg px-4 py-3 text-sm text-muted">{preview.reason}</div>;
  }

  const handleApprove = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await onApproveAndSend(match.id);
    } catch {
      setError("Couldn't prepare your application. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return <PreviewAndApprove preview={preview} isSubmitting={isSubmitting} error={error} onApprove={handleApprove} />;
}
