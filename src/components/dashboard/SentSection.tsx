import { SENT_APPLICATION } from "@/lib/dashboardData";

export default function SentSection() {
  return (
    <div className="rounded-3xl border border-slate-200 bg-card p-6 shadow-sm sm:p-8">
      <h3 className="font-display text-lg font-semibold text-text">
        {SENT_APPLICATION.title}
      </h3>
      <p className="mt-1 text-sm text-muted">{SENT_APPLICATION.company}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          {SENT_APPLICATION.status}
        </span>
        <span className="text-xs text-muted">
          Sent {SENT_APPLICATION.sentDate} · {SENT_APPLICATION.method}
        </span>
      </div>
    </div>
  );
}
