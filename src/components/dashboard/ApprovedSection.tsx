import TrustNote from "./TrustNote";
import { APPROVED_JOB } from "@/lib/dashboardData";

export default function ApprovedSection() {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-lg font-semibold text-text">
              {APPROVED_JOB.title}
            </h3>
            <p className="mt-1 text-sm text-muted">{APPROVED_JOB.company}</p>
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {APPROVED_JOB.status}
            </span>
          </div>
          <button
            type="button"
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark sm:shrink-0"
          >
            Review application
          </button>
        </div>
      </div>

      <TrustNote>Nothing is sent without your final approval.</TrustNote>
    </div>
  );
}
