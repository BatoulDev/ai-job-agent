import MatchScoreRing from "@/components/MatchScoreRing";

export default function HeroMatchPreview() {
  return (
    <div className="relative mx-auto w-full max-w-sm lg:mx-0">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/10 via-accent/10 to-transparent blur-2xl" />

      <div className="rounded-2xl border border-slate-200 bg-card p-6 shadow-xl shadow-primary/10">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              New match today
            </p>
            <h3 className="mt-1 font-display text-lg font-semibold text-text">
              Junior Marketing Coordinator
            </h3>
            <p className="text-sm text-muted">Cedar Digital · Beirut / Hybrid</p>
          </div>
          <MatchScoreRing score={87} size={64} strokeWidth={6} />
        </div>

        <div className="mt-5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Why it matches
          </p>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
              Social media experience
            </span>
            <span className="rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
              Canva / design projects
            </span>
          </div>
        </div>

        <div className="mt-5 flex gap-2 border-t border-slate-100 pt-4">
          <span className="flex-1 rounded-lg bg-primary py-2 text-center text-xs font-semibold text-white">
            Approve
          </span>
          <span className="flex-1 rounded-lg border border-slate-200 py-2 text-center text-xs font-semibold text-text">
            Edit Letter
          </span>
        </div>
      </div>
    </div>
  );
}
