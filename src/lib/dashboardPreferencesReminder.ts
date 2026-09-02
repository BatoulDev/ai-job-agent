// Tracks whether the "complete your job preferences" reminder modal
// (src/components/dashboard/PreferencesReminderModal.tsx) has already been
// shown to this user during the current browser session, so navigating
// between Dashboard tabs or refreshing the page doesn't reopen it on every
// visit — while a genuinely new login still shows it again while
// preferences are still incomplete, because DashboardHeader's handleLogout
// clears this flag on sign-out.
//
// Keyed by user id (not a bare boolean) so a different account signing in
// on the same tab/browser is never suppressed by a flag left behind by the
// previous account.
const SESSION_KEY = "ai-job-agent.dashboard_pref_reminder_shown_for";

type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function hasShownPreferencesReminder(
  userId: string,
  storage: FlagStorage = sessionStorage
): boolean {
  try {
    return storage.getItem(SESSION_KEY) === userId;
  } catch {
    return false;
  }
}

export function markPreferencesReminderShown(
  userId: string,
  storage: FlagStorage = sessionStorage
): void {
  try {
    storage.setItem(SESSION_KEY, userId);
  } catch {
    // sessionStorage unavailable — degrade gracefully; the reminder may
    // show again next visit, which is safe and never a dead end.
  }
}

export function clearPreferencesReminderShown(
  storage: FlagStorage = sessionStorage
): void {
  try {
    storage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
