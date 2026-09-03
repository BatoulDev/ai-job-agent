import Link from "next/link";

// Shown only when international search is enabled (Pro-only) but its
// conditional preferences (relocation willingness / locations / work
// authorization) are incomplete — see
// src/lib/entitlements/readiness.ts's internationalPreferencesComplete,
// wrapping public.get_onboarding_readiness(). Deliberately separate from
// PreferencesReminderBanner: standard Lebanon matching keeps working while
// this is shown (AGENTS.md: "missing international fields block only
// international matching"), and a Pro user who intentionally leaves
// international search disabled never sees this at all.
export default function InternationalPreferencesReminderBanner() {
  return (
    <div
      role="region"
      aria-label="International job search setup incomplete"
      className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="text-sm font-semibold text-text">
          Finish setting up your international job search
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Your Lebanon matches keep coming as usual — a few more questions
          are needed before we can also search outside Lebanon for you.
        </p>
      </div>
      <Link
        href="/onboarding/preferences#international-preferences"
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Set up international job preferences
      </Link>
    </div>
  );
}
