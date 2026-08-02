"use client";

import { useState } from "react";
import MatchScoreRing from "@/components/MatchScoreRing";

const MATCH_REASONS = [
  "Social media experience",
  "Canva / design projects",
  "English communication skills",
];

const MISSING_SKILLS = ["Google Analytics", "Paid ads experience"];

export default function JobMatchCard() {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">(
    "pending"
  );

  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-card p-8 shadow-xl shadow-primary/5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Today&apos;s match
          </p>
          <h3 className="mt-1 font-display text-xl font-semibold text-text">
            Junior Marketing Coordinator
          </h3>
          <p className="mt-1 text-sm text-muted">
            Cedar Digital · Beirut / Hybrid
          </p>
        </div>
        <MatchScoreRing score={87} size={84} strokeWidth={7} label="match" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Why it matches
          </p>
          <ul className="mt-3 space-y-2">
            {MATCH_REASONS.map((reason) => (
              <li key={reason} className="flex items-start gap-2 text-sm text-text">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="2.5"
                  className="mt-0.5 shrink-0"
                >
                  <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
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
            {MISSING_SKILLS.map((skill) => (
              <li key={skill} className="flex items-start gap-2 text-sm text-muted">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                {skill}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {status === "pending" ? (
        <div className="mt-7 flex flex-col gap-3 border-t border-slate-100 pt-6 sm:flex-row">
          <button
            type="button"
            onClick={() => setStatus("approved")}
            className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
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
        <div className="mt-7 flex items-center justify-between border-t border-slate-100 pt-6">
          <p className="text-sm font-medium text-text">
            {status === "approved"
              ? "Approved — your cover letter is ready to review."
              : "Rejected — we won't show this match again."}
          </p>
          <button
            type="button"
            onClick={() => setStatus("pending")}
            className="text-sm font-medium text-primary hover:text-primary-dark"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
