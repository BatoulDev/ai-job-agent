"use client";

import { useState } from "react";
import MatchScoreRing from "@/components/MatchScoreRing";
import TrustNote from "./TrustNote";
import type { JobMatch } from "@/lib/dashboardData";

const SOURCE_STYLES: Record<JobMatch["source"], string> = {
  "Company careers": "bg-primary/10 text-primary",
  "Email apply": "bg-accent/10 text-accent",
  "LinkedIn manual": "bg-slate-100 text-muted",
};

export default function MatchCard({ match }: { match: JobMatch }) {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">(
    "pending"
  );

  return (
    <div className="rounded-3xl border border-slate-200 bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${SOURCE_STYLES[match.source]}`}
          >
            {match.source}
          </span>
          <h3 className="mt-3 font-display text-xl font-semibold text-text">
            {match.title}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {match.company} · {match.location}
          </p>
        </div>
        <MatchScoreRing score={match.matchScore} size={76} strokeWidth={6} label="match" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Why it matches
          </p>
          <ul className="mt-3 space-y-2">
            {match.whyItMatches.map((reason) => (
              <li
                key={reason}
                className="flex items-start gap-2 text-sm text-text"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="2.5"
                  className="mt-0.5 shrink-0"
                >
                  <path
                    d="m5 13 4 4L19 7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {reason}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Missing skills
          </p>
          <ul className="mt-3 space-y-2">
            {match.missingSkills.map((skill) => (
              <li
                key={skill}
                className="flex items-start gap-2 text-sm text-amber-700"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                {skill}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-bg p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Cover letter preview
        </p>
        <p className="mt-2 text-sm leading-relaxed text-text">
          {match.coverLetterPreview}
        </p>
      </div>

      {match.source === "LinkedIn manual" && (
        <div className="mt-4">
          <TrustNote>
            LinkedIn jobs are manual apply only. We prepare your materials,
            but you apply yourself.
          </TrustNote>
        </div>
      )}

      {status === "pending" ? (
        <div className="mt-7 flex flex-col gap-3 border-t border-slate-100 pt-6 sm:flex-row">
          <button
            type="button"
            onClick={() => setStatus("approved")}
            className="flex-1 rounded-lg bg-success py-2.5 text-sm font-semibold text-white transition-colors hover:bg-success/90"
          >
            Approve
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-semibold text-text transition-colors hover:border-slate-300"
          >
            Edit Cover Letter
          </button>
          <button
            type="button"
            onClick={() => setStatus("rejected")}
            className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-muted transition-colors hover:text-text"
          >
            Reject
          </button>
        </div>
      ) : (
        <div className="mt-7 flex items-center justify-between gap-3 border-t border-slate-100 pt-6">
          <p
            className={`text-sm font-medium ${
              status === "approved" ? "text-success" : "text-red-600"
            }`}
          >
            {status === "approved"
              ? "Approved — ready for your final review before sending."
              : "Rejected — this match is hidden from New Matches."}
          </p>
          <button
            type="button"
            onClick={() => setStatus("pending")}
            className="shrink-0 text-sm font-medium text-primary hover:text-primary-dark"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
