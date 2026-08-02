// Full public.cvs row shape (see
// supabase/migrations/20260714153058_create_cvs.sql and
// supabase/migrations/20260805090010_add_cvs_versioning.sql).
//
// SCHEMA NOTE: cvs_user_id_key (a plain unique(user_id) constraint) still
// exists alongside is_active/version/superseded_at, so in practice there
// is only ever one row per user today — see the SCHEMA CONFLICT comment
// in 20260805090010_add_cvs_versioning.sql for exactly what must change
// (and in what order) before a second, historical row can ever exist.
export type CvStatus = "uploaded" | "parsed" | "failed";

export interface Cv {
  id: string;
  user_id: string;
  storage_path: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  status: CvStatus;
  // Increments each time this user replaces their CV. Not yet written by
  // any code path — see the schema note above.
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
