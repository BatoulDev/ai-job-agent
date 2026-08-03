// Gates the "New Matches" tab (the "Get matches" onboarding step) until
// the user has an approved, current AI Career Profile. No job matching
// exists yet in this phase — this is an honest lock, not a placeholder
// for fake results (see src/lib/cvAnalysis/profileState.ts for the real
// analysis lifecycle this reads from).
export default function LockedMatchesNotice({
  onReviewProfile,
}: {
  onReviewProfile: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-slate-200 bg-card px-6 py-14 text-center shadow-sm">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="max-w-sm">
        <h2 className="font-display text-lg font-semibold text-text">
          Job matches unlock after your profile is approved
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Review your CV information and AI career recommendations on the
          CV Profile tab and approve your profile — matches will appear
          here once that&apos;s done.
        </p>
      </div>
      <button
        type="button"
        onClick={onReviewProfile}
        className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
      >
        Review your AI Career Profile
      </button>
    </div>
  );
}
