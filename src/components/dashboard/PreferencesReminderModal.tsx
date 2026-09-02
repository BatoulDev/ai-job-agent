"use client";

import Link from "next/link";
import Dialog from "@/components/dashboard/cvProfile/Dialog";

// Shown once per browser/login session (gated by the caller — see
// src/lib/dashboardPreferencesReminder.ts) when the Dashboard first loads
// for a user who has an active CV but incomplete job preferences. Purely
// informational: dismissing it never writes to the database or marks
// preferences complete — src/components/dashboard/PreferencesReminderBanner
// stays visible afterward as the persistent, non-modal reminder.
export default function PreferencesReminderModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} titleId="preferences-reminder-title">
      <h2
        id="preferences-reminder-title"
        className="font-display text-xl font-semibold tracking-tight text-text"
      >
        Complete your job preferences
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Your CV is ready. Add your job preferences so we can prepare your AI
        Career Profile and personalize your job matches.
      </p>
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-full border border-slate-200 px-6 py-3 text-sm font-semibold text-muted transition-colors hover:border-slate-300 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:w-auto"
        >
          Not now
        </button>
        <Link
          href="/onboarding/preferences"
          className="w-full rounded-full bg-primary px-6 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:w-auto"
        >
          Complete preferences
        </Link>
      </div>
    </Dialog>
  );
}
