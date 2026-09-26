// Mirrors public.cover_letters (supabase/migrations/20260809090050_create_cover_letters.sql).
// Manually maintained, following this project's existing convention (see
// src/lib/cvAnalysis/types.ts, src/lib/matches/types.ts).

export type CoverLetterGenerationStatus = "pending" | "completed" | "failed";
export type CoverLetterApprovalStatus = "draft" | "user_approved";

export interface CoverLetterRecord {
  id: string;
  matchId: string;
  generatedContent: string | null;
  editedContent: string | null;
  approvedContent: string | null;
  generationStatus: CoverLetterGenerationStatus;
  approvalStatus: CoverLetterApprovalStatus;
}

export interface CoverLetterRow {
  id: string;
  match_id: string;
  generated_content: string | null;
  edited_content: string | null;
  approved_content: string | null;
  generation_status: string;
  approval_status: string;
}

export function mapCoverLetterRow(row: CoverLetterRow): CoverLetterRecord {
  return {
    id: row.id,
    matchId: row.match_id,
    generatedContent: row.generated_content,
    editedContent: row.edited_content,
    approvedContent: row.approved_content,
    generationStatus: row.generation_status as CoverLetterGenerationStatus,
    approvalStatus: row.approval_status as CoverLetterApprovalStatus,
  };
}
