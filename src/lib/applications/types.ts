// Mirrors public.applications (supabase/migrations/20260809090060_create_applications.sql).
// Manually maintained, following this project's existing convention (see
// src/lib/matches/types.ts, src/lib/coverLetters/types.ts).

export type ApplicationMethod = "external_link" | "email";
export type ApplicationStatus = "pending_send" | "sending" | "sent" | "failed" | "cancelled";

export interface ApplicationRecord {
  id: string;
  matchId: string;
  jobId: string;
  coverLetterId: string | null;
  applicationMethod: ApplicationMethod;
  status: ApplicationStatus;
  sendAttemptCount: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  providerMessageId: string | null;
  approvedAt: string;
}

export interface ApplicationRow {
  id: string;
  match_id: string;
  job_id: string;
  cover_letter_id: string | null;
  application_method: string;
  status: string;
  send_attempt_count: number;
  last_attempt_at: string | null;
  last_error: string | null;
  provider_message_id: string | null;
  approved_at: string;
}

export function mapApplicationRow(row: ApplicationRow): ApplicationRecord {
  return {
    id: row.id,
    matchId: row.match_id,
    jobId: row.job_id,
    coverLetterId: row.cover_letter_id,
    applicationMethod: row.application_method as ApplicationMethod,
    status: row.status as ApplicationStatus,
    sendAttemptCount: row.send_attempt_count,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
    providerMessageId: row.provider_message_id,
    approvedAt: row.approved_at,
  };
}
