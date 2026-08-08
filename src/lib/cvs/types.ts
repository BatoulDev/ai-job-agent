// Full public.cvs row shape (see
// supabase/migrations/20260714153058_create_cvs.sql,
// supabase/migrations/20260805090010_add_cvs_versioning.sql, and
// supabase/migrations/20260809090010_resolve_cvs_versioning_conflict.sql).
//
// A user may now have multiple rows (full history preserved): at most one
// with is_active = true (cvs_one_active_per_user), any number of
// historical (is_active = false) rows. Writes go only through the
// replace_cv() database function (src/app/onboarding/upload-cv/page.tsx) —
// cvs_insert_own/cvs_update_own no longer exist, so a direct client
// insert/update is rejected.
export type CvStatus = "uploaded" | "parsed" | "failed";

export interface Cv {
  id: string;
  user_id: string;
  storage_path: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  status: CvStatus;
  // Incremented by replace_cv() each time this user replaces their CV.
  version: number;
  // At most one true row per user (cvs_one_active_per_user). This is
  // "the" CV analysis_tasks/cv_analyses should treat as current.
  is_active: boolean;
  // Set when a newer CV version replaces this one. Null for the active
  // row and for every row created before versioning existed.
  superseded_at: string | null;
  created_at: string;
  updated_at: string;
}
