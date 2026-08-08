import type { ExperienceLevel } from "@/lib/experienceLevel";

// Mirrors supabase/migrations/20260804090010_create_cv_analyses.sql,
// supabase/migrations/20260805090030_extend_cv_analyses_lifecycle.sql, and
// supabase/migrations/20260809090100_add_cv_analyses_review_confirm.sql
// exactly. Wired to a real backend now via src/lib/cvAnalysis/review.ts
// (GET/review/confirm — see src/app/api/cv-analysis/*). Kept here,
// manually maintained, following this project's existing convention (see
// src/lib/plans/types.ts). A generated types file now also exists
// (src/lib/supabase/database.types.ts, `npm run db:types`) — check this
// interface against its `public.cv_analyses` Row type after any future
// schema change to cv_analyses.
//
// Three independent lifecycle dimensions — never conflate them:
//   status              — processing lifecycle (did the extraction/AI run succeed?)
//   review_status       — user review lifecycle (did the user approve this result?)
//   recommendations_state (+ is_current) — system-determined validity: is this
//     record still current, or has the CV/preferences it was based on moved on?
// An analysis can be status="completed", review_status="approved" (permanent
// historical facts) while recommendations_state="stale" or "superseded" and
// is_current=false (it stopped being the authoritative record) — these do
// not imply each other.

export type CvAnalysisStatus = "processing" | "completed" | "failed";
// 'superseded' added by supabase/migrations/20260809090100_add_cv_analyses_review_confirm.sql:
// cv_analyses_one_approved_per_user allows at most one row with
// review_status = 'approved' per user, ever — when a newer analysis is
// approved (or the CV it was based on is replaced), the previous row's
// review_status moves to 'superseded' rather than staying 'approved'.
// approved_at is the permanent historical record of when it was approved,
// independent of the current review_status value.
export type CvAnalysisReviewStatus = "pending_review" | "approved" | "changes_requested" | "superseded";
export type CvAnalysisRecommendationsState = "current" | "stale" | "superseded";

// cv_facts — extracted only from the CV. Never invented or altered by
// preferences. Shapes below are a reasonable starting contract for the
// future extraction step; the actual worker (not built in this phase) is
// the source of truth for exact structure and may refine these.
export interface CvEducationEntry {
  institution: string;
  degree?: string;
  field_of_study?: string;
  start_date?: string;
  end_date?: string;
  details?: string;
}

export interface CvWorkExperienceEntry {
  title: string;
  organization: string;
  start_date?: string;
  end_date?: string;
  location?: string;
  highlights?: string[];
}

export interface CvProjectEntry {
  name: string;
  description?: string;
  technologies?: string[];
  date?: string;
}

export interface CvCertificationEntry {
  name: string;
  issuer?: string;
  date?: string;
}

export interface CvLanguageEntry {
  language: string;
  proficiency?: string;
}

export interface CvContactInfo {
  email?: string;
  phone?: string;
  location?: string;
  links?: string[];
}

export interface CvFacts {
  professional_summary: string | null;
  skills: string[];
  education: CvEducationEntry[];
  work_experience: CvWorkExperienceEntry[];
  projects: CvProjectEntry[];
  certifications: CvCertificationEntry[];
  languages: CvLanguageEntry[];
  contact_info: CvContactInfo | null;
  extracted_text: string | null;
}

// preference_snapshot — a historical copy of job_preferences at analysis
// time. NOT the current source of truth; job_preferences is. Structure
// matches job_preferences' own columns (see src/app/onboarding/preferences/page.tsx).
export interface PreferenceSnapshot {
  target_roles: string[];
  location: string[];
  work_arrangement: string | null;
  job_market_coverage: string | null;
  job_type: string | null;
  experience_level: string | null;
  additional_notes: string | null;
}

// ai_career_profile — conclusions drawn from cv_facts + preference_snapshot.
export interface AiCareerProfile {
  profile_level: ExperienceLevel | null;
  recommended_roles: string[];
  strongest_areas: string[];
  career_recommendations: string[];
  search_focus: string[];
  development_areas: string[];
}

export interface CvAnalysis extends CvFacts, AiCareerProfile {
  id: string;
  user_id: string;
  cv_id: string;
  analysis_task_id: string | null;

  status: CvAnalysisStatus;
  error_message: string | null;
  ai_provider: string | null;
  ai_model: string | null;
  analysis_version: string;
  analyzed_at: string | null;

  preference_snapshot: PreferenceSnapshot;
  // The job_preferences.version preference_snapshot/ai_career_profile were
  // generated against — compare with the live JobPreferences.version (see
  // src/lib/jobPreferences/types.ts) to detect staleness. Null for
  // analyses created before this concept existed.
  preferences_version: number | null;

  review_status: CvAnalysisReviewStatus;
  user_edits: Record<string, unknown> | null;
  reviewed_at: string | null;
  approved_at: string | null;

  // Whether this is the record future job matching should read. At most
  // one true row per user. Independent of review_status — see the header
  // comment.
  is_current: boolean;
  recommendations_state: CvAnalysisRecommendationsState;
  // Set when recommendations_state becomes "superseded" (the CV this
  // analysis was based on is no longer the user's active CV).
  superseded_at: string | null;

  created_at: string;
  updated_at: string;
}
