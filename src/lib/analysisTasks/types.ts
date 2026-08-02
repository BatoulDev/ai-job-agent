// Full public.analysis_tasks row shape (see
// supabase/migrations/20260802090030_create_analysis_tasks.sql and
// supabase/migrations/20260805090020_extend_analysis_tasks_lifecycle.sql).
//
// `trigger` and `task_type` are deliberately separate fields: trigger
// records WHY a task was created (today only "onboarding_completed" is
// allowed by the database); task_type records WHAT KIND of analysis work
// it is. No code path creates a "career_profile_refresh" task yet — every
// existing caller (create_analysis_task, called with 3 args) gets
// task_type="full_analysis" from the column default.
export type AnalysisTaskTrigger = "onboarding_completed";
export type AnalysisTaskType = "full_analysis" | "career_profile_refresh";
export type AnalysisTaskStatus = "pending" | "processing" | "completed" | "failed";

export interface AnalysisTask {
  id: string;
  user_id: string;
  cv_id: string;
  trigger: AnalysisTaskTrigger;
  task_type: AnalysisTaskType;
  status: AnalysisTaskStatus;
  attempt_count: number;
  max_attempts: number;
  available_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  // Error detail lives here, not a separate "error_message" column — see
  // the mapping note in 20260805090020_extend_analysis_tasks_lifecycle.sql.
  last_error: string | null;
  // The job_preferences.version this task targets. Auto-populated from
  // the user's current job_preferences row at insert time when not
  // explicitly supplied (set_analysis_task_preferences_version) — never
  // trust a value for this beyond that server-computed snapshot.
  preferences_version: number | null;
  // Set by future orchestration logic (not yet implemented) when a newer
  // task makes this one moot. A future claim function must exclude rows
  // where this is not null.
  superseded_at: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}
