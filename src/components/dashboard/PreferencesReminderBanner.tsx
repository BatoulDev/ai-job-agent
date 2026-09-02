import Link from "next/link";

// Persistent, non-modal fallback shown on the Dashboard for as long as a
// user has an active CV but incomplete job preferences — visible on every
// visit (unlike PreferencesReminderModal, which only appears once per
// session), so the required action stays discoverable without trapping the
// user in a dialog. Disappears automatically once the caller's
// preferencesComplete condition flips true; it never writes to the
// database itself.
export default function PreferencesReminderBanner() {
  return (
    <div
      role="region"
      aria-label="Job preferences incomplete"
      className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="text-sm font-semibold text-text">
          Your job preferences are incomplete
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Add your job preferences so we can prepare your AI Career Profile
          and personalize your job matches.
        </p>
      </div>
      <Link
        href="/onboarding/preferences"
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Complete preferences
      </Link>
    </div>
  );
}
