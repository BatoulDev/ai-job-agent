"use client";

import { useState } from "react";
import type { MatchWithJob } from "@/lib/matches/types";

// A match only ever reaches this card if it passed hard eligibility, so an
// unknown work arrangement here was never a mismatch — the employer/source
// just didn't state it. Say so plainly rather than silently omitting it
// (founder decision, docs/PRODUCT_MATCHING_RULES.md "Work arrangement").
function formatMeta(job: MatchWithJob["job"]) {
  const workArrangement = job.workArrangement ?? "Work arrangement not specified";
  return [job.location, workArrangement, job.employmentType].filter(Boolean).join(" · ");
}

export default function MatchCard({
  match,
  onApprove,
  onReject,
}: {
  match: MatchWithJob;
  onApprove?: (matchId: string) => Promise<void>;
  onReject?: (matchId: string) => Promise<void>;
}) {
  const [isDeciding, setIsDeciding] = useState<"approve" | "reject" | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const meta = formatMeta(match.job);

  const handleDecision = async (kind: "approve" | "reject", action: (matchId: string) => Promise<void>) => {
    setDecisionError(null);
    setIsDeciding(kind);
    try {
      await action(match.id);
    } catch {
      setDecisionError("Couldn't save your decision. Please try again.");
    } finally {
      setIsDeciding(null);
    }
  };

  return (
    <div data-testid={`match-${match.id}`} className="rounded-3xl border border-slate-200 bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="font-display text-base font-semibold text-text">{match.job.title}</h3>
          <p className="mt-1 text-sm text-muted">{match.job.companyName}</p>
          {meta && <p className="mt-1 text-xs text-muted">{meta}</p>}
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
          {match.score}% match
        </span>
      </div>

      {match.explanation && <p className="mt-4 text-sm leading-relaxed text-text">{match.explanation}</p>}

      {match.strengths.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {match.strengths.map((strength) => (
            <span key={strength} className="rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
              {strength}
            </span>
          ))}
        </div>
      )}

      {match.missingSkills.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {match.missingSkills.map((skill) => (
            <span key={skill} className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              Missing: {skill}
            </span>
          ))}
        </div>
      )}

      {onApprove && onReject && (
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => handleDecision("approve", onApprove)}
            disabled={isDeciding !== null}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDeciding === "approve" ? "Approving..." : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => handleDecision("reject", onReject)}
            disabled={isDeciding !== null}
            className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-text transition-colors hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDeciding === "reject" ? "Rejecting..." : "Reject"}
          </button>
        </div>
      )}

      {decisionError && (
        <p role="alert" className="mt-3 text-xs text-red-700">
          {decisionError}
        </p>
      )}
    </div>
  );
}
