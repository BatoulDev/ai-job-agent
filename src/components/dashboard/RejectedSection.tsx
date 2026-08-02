import { REJECTED_JOB } from "@/lib/dashboardData";

export default function RejectedSection() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-card p-6 shadow-sm sm:p-8">
      <h3 className="font-display text-lg font-semibold text-text">
        {REJECTED_JOB.title}
      </h3>
      <p className="mt-1 text-sm text-muted">{REJECTED_JOB.company}</p>

      <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600">
        Rejected
      </span>

      <p className="mt-3 text-sm text-muted">
        Reason: {REJECTED_JOB.reason}
      </p>
    </div>
  );
}
