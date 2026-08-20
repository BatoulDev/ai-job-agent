import type { AnalysisTaskStatus, AnalysisTaskTrigger } from "@/lib/analysisTasks/types";

export interface ProfileUpdatePendingFlag {
  trigger: AnalysisTaskTrigger;
  setAt: number;
}

export const SESSION_KEY = "ai-job-agent.profile_update_pending";
export const MAX_AGE_MS = 25_000;
export const OPTIMISTIC_TIMEOUT_MS = 20_000;

type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Sets a sessionStorage flag so the dashboard can show an optimistic
// progress panel immediately after redirect, before the DB task row
// is visible to the polling query.
//
// When trigger="preferences_updated" and an active cv_replaced flag
// already exists, the cv_replaced flag is preserved. The CV replacement
// is the primary trigger and the subsequent preferences save should not
// overwrite it during the same onboarding flow.
export function setProfileUpdatePending(
  trigger: AnalysisTaskTrigger,
  storage: FlagStorage = sessionStorage
): void {
  if (trigger === "preferences_updated") {
    const existing = readFlagRaw(storage);
    if (existing && existing.trigger === "cv_replaced" && Date.now() - existing.setAt < MAX_AGE_MS) {
      return;
    }
  }
  storage.setItem(SESSION_KEY, JSON.stringify({ trigger, setAt: Date.now() }));
}

// Reads and immediately clears the flag. Returns null if missing,
// malformed, or older than MAX_AGE_MS (stale from a previous visit).
export function readAndClearProfileUpdatePending(
  storage: FlagStorage = sessionStorage
): ProfileUpdatePendingFlag | null {
  const flag = readFlagRaw(storage);
  storage.removeItem(SESSION_KEY);
  if (!flag) return null;
  if (Date.now() - flag.setAt > MAX_AGE_MS) return null;
  return flag;
}

function readFlagRaw(storage: Pick<Storage, "getItem">): ProfileUpdatePendingFlag | null {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { trigger?: unknown }).trigger !== "string" ||
      typeof (parsed as { setAt?: unknown }).setAt !== "number"
    ) {
      return null;
    }
    return parsed as ProfileUpdatePendingFlag;
  } catch {
    return null;
  }
}

export interface EffectiveTaskState {
  effectiveTaskStatus: AnalysisTaskStatus | null;
  effectiveTaskTrigger: AnalysisTaskTrigger | null;
  // True only while we have an optimistic trigger AND no DB task has been
  // confirmed yet (taskStatus === null). Controls the "This may take a few
  // moments" secondary text in the spinner.
  isOptimistic: boolean;
  // True when the optimistic trigger is present AND the DB task reached a
  // terminal status — signals the caller to clear the optimistic state.
  shouldClearOptimistic: boolean;
}

// Pure function: derives the task state that the dashboard UI should
// display, merging the real DB state with the short-lived optimistic state.
export function computeEffectiveTaskState(
  taskStatus: AnalysisTaskStatus | null,
  taskTrigger: AnalysisTaskTrigger | null,
  optimisticTrigger: AnalysisTaskTrigger | null,
  optimisticTimedOut: boolean
): EffectiveTaskState {
  const hasOptimistic = optimisticTrigger !== null;

  const shouldClearOptimistic =
    hasOptimistic && (taskStatus === "completed" || taskStatus === "failed");

  // "isOptimistic" means: we have a flag, no timeout, and the DB has not
  // yet returned any task row. The UI synthesises a "pending" task so that
  // deriveCvProfileState() returns "analyzing" immediately.
  const isOptimistic = hasOptimistic && !optimisticTimedOut && taskStatus === null;

  const effectiveTaskStatus = isOptimistic ? "pending" : taskStatus;
  const effectiveTaskTrigger = isOptimistic ? optimisticTrigger : taskTrigger;

  return { effectiveTaskStatus, effectiveTaskTrigger, isOptimistic, shouldClearOptimistic };
}
