"use client";

import { useState } from "react";
import EmptyTabState from "./EmptyTabState";
import TrustNote from "./TrustNote";
import type { MatchWithJob } from "@/lib/matches/types";
import type { ApplicationRecord } from "@/lib/applications/types";
import type { ApplicationOutcomeRecord, ApplicationOutcomeStatus } from "@/lib/applications/outcomeTypes";

const OUTCOME_OPTIONS: { value: ApplicationOutcomeStatus; label: string }[] = [
  { value: "interviewing", label: "Interviewing" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
];

const OUTCOME_LABELS: Record<ApplicationOutcomeStatus, string> = {
  unknown: "No update yet",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const OUTCOME_STYLES: Record<ApplicationOutcomeStatus, string> = {
  unknown: "bg-slate-100 text-muted",
  interviewing: "bg-accent/10 text-accent",
  offer: "bg-success/10 text-success",
  rejected: "bg-red-50 text-red-700",
  withdrawn: "bg-slate-100 text-muted",
};

function SentApplicationCard({
  match,
  application,
  outcome,
  onReportOutcome,
}: {
  match: MatchWithJob;
  application: ApplicationRecord;
  outcome: ApplicationOutcomeRecord | null;
  onReportOutcome: (applicationId: string, status: ApplicationOutcomeStatus) => Promise<void>;
}) {
  const [isSaving, setIsSaving] = useState<ApplicationOutcomeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentStatus = outcome?.outcomeStatus ?? "unknown";

  const handleReport = async (status: ApplicationOutcomeStatus) => {
    setError(null);
    setIsSaving(status);
    try {
      await onReportOutcome(application.id, status);
    } catch {
      setError("Couldn't save this update. Please try again.");
    } finally {
      setIsSaving(null);
    }
  };

  return (
    <div data-testid={`sent-application-${application.id}`} className="rounded-3xl border border-slate-200 bg-card p-6 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-display text-base font-semibold text-text">{match.job.title}</h3>
          <p className="mt-1 text-sm text-muted">{match.job.companyName}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-semibold ${OUTCOME_STYLES[currentStatus]}`}>
          {OUTCOME_LABELS[currentStatus]}
        </span>
      </div>

      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">What happened?</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {OUTCOME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleReport(option.value)}
            disabled={isSaving !== null}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              currentStatus === option.value ? "border-primary bg-primary/10 text-primary" : "border-slate-200 text-text hover:border-slate-300"
            }`}
          >
            {isSaving === option.value ? "Saving..." : option.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

// Manual tracking only (Phase 10) — self-reported outcomes, never inferred
// from email/Gmail parsing. See docs/OVERNIGHT_CREDENTIALS_REQUIRED.md for
// why an automated detector is a deliberate future extension, not built here.
export default function SentSection({
  matches,
  applications,
  outcomes,
  isLoading,
  error,
  onReportOutcome,
}: {
  matches: MatchWithJob[] | null;
  applications: Record<string, ApplicationRecord>;
  outcomes: Record<string, ApplicationOutcomeRecord>;
  isLoading: boolean;
  error: string | null;
  onReportOutcome: (applicationId: string, status: ApplicationOutcomeStatus) => Promise<void>;
}) {
  if (isLoading) {
    return <p className="text-sm text-muted">Loading your sent applications...</p>;
  }
  if (error) {
    return <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>;
  }

  const sent = (matches ?? [])
    .map((match) => ({ match, application: applications[match.id] }))
    .filter((entry): entry is { match: MatchWithJob; application: ApplicationRecord } => entry.application?.status === "sent");

  if (sent.length === 0) {
    return (
      <div className="space-y-6">
        <EmptyTabState title="Nothing sent yet" message="Applications you've approved and sent will appear here." />
        <TrustNote>Nothing is sent without your final approval.</TrustNote>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sent.map(({ match, application }) => (
        <SentApplicationCard
          key={application.id}
          match={match}
          application={application}
          outcome={outcomes[application.id] ?? null}
          onReportOutcome={onReportOutcome}
        />
      ))}
      <TrustNote>Outcomes here are self-reported by you — never inferred automatically.</TrustNote>
    </div>
  );
}
