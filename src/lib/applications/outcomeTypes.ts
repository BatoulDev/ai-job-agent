// Mirrors public.application_outcomes
// (supabase/migrations/20260928100000_add_application_outcomes_and_manual_tracking.sql).
// Manually maintained, following this project's existing convention.

export type ApplicationOutcomeStatus = "unknown" | "interviewing" | "rejected" | "offer" | "withdrawn";

export interface ApplicationOutcomeRecord {
  id: string;
  applicationId: string;
  outcomeStatus: ApplicationOutcomeStatus;
  notes: string | null;
  updatedAt: string;
}

export interface ApplicationOutcomeRow {
  id: string;
  application_id: string;
  outcome_status: string;
  notes: string | null;
  updated_at: string;
}

export function mapApplicationOutcomeRow(row: ApplicationOutcomeRow): ApplicationOutcomeRecord {
  return {
    id: row.id,
    applicationId: row.application_id,
    outcomeStatus: row.outcome_status as ApplicationOutcomeStatus,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}
