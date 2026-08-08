// GENERATED FILE — do not hand-edit. Regenerate with `npm run db:types`
// (runs `supabase gen types typescript --local`, local database only).
// Existing feature-level types (e.g. src/lib/cvAnalysis/types.ts) remain
// manually maintained per this project's established convention; use this
// file to check them against the real schema, not to replace them wholesale.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      analysis_tasks: {
        Row: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          created_at: string
          cv_id: string
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          max_attempts: number
          preferences_version: number | null
          started_at: string | null
          status: string
          superseded_at: string | null
          task_type: string
          trigger: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          cv_id: string
          failed_at?: string | null
          id?: string
          idempotency_key: string
          last_error?: string | null
          max_attempts?: number
          preferences_version?: number | null
          started_at?: string | null
          status?: string
          superseded_at?: string | null
          task_type?: string
          trigger: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          cv_id?: string
          failed_at?: string | null
          id?: string
          idempotency_key?: string
          last_error?: string | null
          max_attempts?: number
          preferences_version?: number | null
          started_at?: string | null
          status?: string
          superseded_at?: string | null
          task_type?: string
          trigger?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_tasks_cv_id_fkey"
            columns: ["cv_id"]
            isOneToOne: false
            referencedRelation: "cvs"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          application_method: string
          approved_at: string
          approved_by: string
          cover_letter_id: string | null
          created_at: string
          id: string
          idempotency_key: string
          job_id: string
          last_attempt_at: string | null
          last_error: string | null
          match_id: string
          provider_message_id: string | null
          send_attempt_count: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          application_method: string
          approved_at: string
          approved_by: string
          cover_letter_id?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          job_id: string
          last_attempt_at?: string | null
          last_error?: string | null
          match_id: string
          provider_message_id?: string | null
          send_attempt_count?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          application_method?: string
          approved_at?: string
          approved_by?: string
          cover_letter_id?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          job_id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          match_id?: string
          provider_message_id?: string | null
          send_attempt_count?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_cover_letter_id_fkey"
            columns: ["cover_letter_id"]
            isOneToOne: false
            referencedRelation: "cover_letters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          actor_type: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          metadata: Json
          user_id: string | null
        }
        Insert: {
          actor_type: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          metadata?: Json
          user_id?: string | null
        }
        Update: {
          actor_type?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      automation_tasks: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          next_attempt_at: string
          started_at: string | null
          status: string
          subject_id: string
          subject_type: string
          task_type: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          next_attempt_at?: string
          started_at?: string | null
          status?: string
          subject_id: string
          subject_type: string
          task_type: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          next_attempt_at?: string
          started_at?: string | null
          status?: string
          subject_id?: string
          subject_type?: string
          task_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      countries: {
        Row: {
          code: string
          created_at: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      cover_letters: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_content: string | null
          created_at: string
          edited_content: string | null
          generated_content: string | null
          generation_status: string
          id: string
          match_id: string
          model_provider: string | null
          model_version: string | null
          revision: number
          updated_at: string
          user_id: string
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_content?: string | null
          created_at?: string
          edited_content?: string | null
          generated_content?: string | null
          generation_status?: string
          id?: string
          match_id: string
          model_provider?: string | null
          model_version?: string | null
          revision?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_content?: string | null
          created_at?: string
          edited_content?: string | null
          generated_content?: string | null
          generation_status?: string
          id?: string
          match_id?: string
          model_provider?: string | null
          model_version?: string | null
          revision?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cover_letters_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      cv_analyses: {
        Row: {
          ai_model: string | null
          ai_provider: string | null
          analysis_task_id: string | null
          analysis_version: string
          analyzed_at: string | null
          approved_at: string | null
          career_recommendations: Json
          certifications: Json
          contact_info: Json | null
          created_at: string
          cv_id: string
          development_areas: Json
          education: Json
          error_message: string | null
          extracted_text: string | null
          id: string
          is_current: boolean
          languages: Json
          preference_snapshot: Json
          preferences_version: number | null
          professional_summary: string | null
          profile_level: string | null
          projects: Json
          recommendations_state: string
          recommended_roles: Json
          review_status: string
          reviewed_at: string | null
          search_focus: Json
          skills: Json
          status: string
          strongest_areas: Json
          superseded_at: string | null
          updated_at: string
          user_edits: Json | null
          user_id: string
          work_experience: Json
        }
        Insert: {
          ai_model?: string | null
          ai_provider?: string | null
          analysis_task_id?: string | null
          analysis_version?: string
          analyzed_at?: string | null
          approved_at?: string | null
          career_recommendations?: Json
          certifications?: Json
          contact_info?: Json | null
          created_at?: string
          cv_id: string
          development_areas?: Json
          education?: Json
          error_message?: string | null
          extracted_text?: string | null
          id?: string
          is_current?: boolean
          languages?: Json
          preference_snapshot: Json
          preferences_version?: number | null
          professional_summary?: string | null
          profile_level?: string | null
          projects?: Json
          recommendations_state?: string
          recommended_roles?: Json
          review_status?: string
          reviewed_at?: string | null
          search_focus?: Json
          skills?: Json
          status?: string
          strongest_areas?: Json
          superseded_at?: string | null
          updated_at?: string
          user_edits?: Json | null
          user_id: string
          work_experience?: Json
        }
        Update: {
          ai_model?: string | null
          ai_provider?: string | null
          analysis_task_id?: string | null
          analysis_version?: string
          analyzed_at?: string | null
          approved_at?: string | null
          career_recommendations?: Json
          certifications?: Json
          contact_info?: Json | null
          created_at?: string
          cv_id?: string
          development_areas?: Json
          education?: Json
          error_message?: string | null
          extracted_text?: string | null
          id?: string
          is_current?: boolean
          languages?: Json
          preference_snapshot?: Json
          preferences_version?: number | null
          professional_summary?: string | null
          profile_level?: string | null
          projects?: Json
          recommendations_state?: string
          recommended_roles?: Json
          review_status?: string
          reviewed_at?: string | null
          search_focus?: Json
          skills?: Json
          status?: string
          strongest_areas?: Json
          superseded_at?: string | null
          updated_at?: string
          user_edits?: Json | null
          user_id?: string
          work_experience?: Json
        }
        Relationships: [
          {
            foreignKeyName: "cv_analyses_analysis_task_id_fkey"
            columns: ["analysis_task_id"]
            isOneToOne: true
            referencedRelation: "analysis_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cv_analyses_cv_id_fkey"
            columns: ["cv_id"]
            isOneToOne: false
            referencedRelation: "cvs"
            referencedColumns: ["id"]
          },
        ]
      }
      cvs: {
        Row: {
          created_at: string
          file_name: string
          file_size_bytes: number
          id: string
          is_active: boolean
          mime_type: string
          status: string
          storage_path: string
          superseded_at: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size_bytes: number
          id?: string
          is_active?: boolean
          mime_type: string
          status?: string
          storage_path: string
          superseded_at?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size_bytes?: number
          id?: string
          is_active?: boolean
          mime_type?: string
          status?: string
          storage_path?: string
          superseded_at?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      daily_news_briefs: {
        Row: {
          brief_date: string
          created_at: string
          id: string
          is_published: boolean
        }
        Insert: {
          brief_date: string
          created_at?: string
          id?: string
          is_published?: boolean
        }
        Update: {
          brief_date?: string
          created_at?: string
          id?: string
          is_published?: boolean
        }
        Relationships: []
      }
      daily_news_items: {
        Row: {
          brief_id: string
          created_at: string
          headline: string
          id: string
          position: number
          source_url: string | null
          summary: string
        }
        Insert: {
          brief_id: string
          created_at?: string
          headline: string
          id?: string
          position: number
          source_url?: string | null
          summary: string
        }
        Update: {
          brief_id?: string
          created_at?: string
          headline?: string
          id?: string
          position?: number
          source_url?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_news_items_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "daily_news_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_preference_locations: {
        Row: {
          created_at: string
          job_preference_id: string
          location_id: string
        }
        Insert: {
          created_at?: string
          job_preference_id: string
          location_id: string
        }
        Update: {
          created_at?: string
          job_preference_id?: string
          location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_preference_locations_job_preference_id_fkey"
            columns: ["job_preference_id"]
            isOneToOne: false
            referencedRelation: "job_preferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_preference_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["slug"]
          },
        ]
      }
      job_preference_target_roles: {
        Row: {
          created_at: string
          job_preference_id: string
          target_role_id: string
        }
        Insert: {
          created_at?: string
          job_preference_id: string
          target_role_id: string
        }
        Update: {
          created_at?: string
          job_preference_id?: string
          target_role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_preference_target_roles_job_preference_id_fkey"
            columns: ["job_preference_id"]
            isOneToOne: false
            referencedRelation: "job_preferences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_preference_target_roles_target_role_id_fkey"
            columns: ["target_role_id"]
            isOneToOne: false
            referencedRelation: "target_roles"
            referencedColumns: ["slug"]
          },
        ]
      }
      job_preferences: {
        Row: {
          additional_notes: string | null
          created_at: string
          custom_locations: string[] | null
          custom_target_roles: string[] | null
          experience_level: string | null
          id: string
          job_market_coverage: string | null
          job_type: string | null
          location: string | null
          target_roles: string | null
          updated_at: string
          user_id: string
          version: number
          work_arrangement: string | null
        }
        Insert: {
          additional_notes?: string | null
          created_at?: string
          custom_locations?: string[] | null
          custom_target_roles?: string[] | null
          experience_level?: string | null
          id?: string
          job_market_coverage?: string | null
          job_type?: string | null
          location?: string | null
          target_roles?: string | null
          updated_at?: string
          user_id: string
          version?: number
          work_arrangement?: string | null
        }
        Update: {
          additional_notes?: string | null
          created_at?: string
          custom_locations?: string[] | null
          custom_target_roles?: string[] | null
          experience_level?: string | null
          id?: string
          job_market_coverage?: string | null
          job_type?: string | null
          location?: string | null
          target_roles?: string | null
          updated_at?: string
          user_id?: string
          version?: number
          work_arrangement?: string | null
        }
        Relationships: []
      }
      jobs: {
        Row: {
          application_email: string | null
          application_method: string
          application_url: string | null
          company_name: string
          created_at: string
          created_by: string | null
          description: string
          discovered_at: string
          employment_type: string | null
          expires_at: string | null
          external_id: string | null
          id: string
          location: string | null
          published_at: string | null
          seniority: string | null
          source_type: string
          source_url: string | null
          status: string
          title: string
          updated_at: string
          work_arrangement: string | null
        }
        Insert: {
          application_email?: string | null
          application_method: string
          application_url?: string | null
          company_name: string
          created_at?: string
          created_by?: string | null
          description: string
          discovered_at?: string
          employment_type?: string | null
          expires_at?: string | null
          external_id?: string | null
          id?: string
          location?: string | null
          published_at?: string | null
          seniority?: string | null
          source_type: string
          source_url?: string | null
          status?: string
          title: string
          updated_at?: string
          work_arrangement?: string | null
        }
        Update: {
          application_email?: string | null
          application_method?: string
          application_url?: string | null
          company_name?: string
          created_at?: string
          created_by?: string | null
          description?: string
          discovered_at?: string
          employment_type?: string | null
          expires_at?: string | null
          external_id?: string | null
          id?: string
          location?: string | null
          published_at?: string | null
          seniority?: string | null
          source_type?: string
          source_url?: string | null
          status?: string
          title?: string
          updated_at?: string
          work_arrangement?: string | null
        }
        Relationships: []
      }
      locations: {
        Row: {
          country_code: string
          created_at: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      majors: {
        Row: {
          category: string
          created_at: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      matches: {
        Row: {
          created_at: string
          cv_analysis_id: string
          decided_at: string | null
          explanation: string | null
          hard_filter_passed: boolean
          id: string
          job_id: string
          matching_model: string | null
          matching_version: string
          missing_skills: Json
          score: number
          score_breakdown: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          cv_analysis_id: string
          decided_at?: string | null
          explanation?: string | null
          hard_filter_passed?: boolean
          id?: string
          job_id: string
          matching_model?: string | null
          matching_version?: string
          missing_skills?: Json
          score: number
          score_breakdown?: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          cv_analysis_id?: string
          decided_at?: string | null
          explanation?: string | null
          hard_filter_passed?: boolean
          id?: string
          job_id?: string
          matching_model?: string | null
          matching_version?: string
          missing_skills?: Json
          score?: number
          score_breakdown?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_cv_analysis_id_fkey"
            columns: ["cv_analysis_id"]
            isOneToOne: false
            referencedRelation: "cv_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          channel: string
          created_at: string
          id: string
          idempotency_key: string | null
          notification_type: string
          read_at: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          sent_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
          notification_type: string
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
          notification_type?: string
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_attempts: {
        Row: {
          amount: number
          checkout_url: string | null
          created_at: string
          currency: string
          failure_code: string | null
          failure_message: string | null
          id: string
          idempotency_key: string
          metadata: Json | null
          plan_code: string
          provider: string
          provider_payment_id: string | null
          status: string
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          amount: number
          checkout_url?: string | null
          created_at?: string
          currency: string
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          idempotency_key: string
          metadata?: Json | null
          plan_code: string
          provider: string
          provider_payment_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          amount?: number
          checkout_url?: string | null
          created_at?: string
          currency?: string
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          idempotency_key?: string
          metadata?: Json | null
          plan_code?: string
          provider?: string
          provider_payment_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["plan_code"]
          },
        ]
      }
      plans: {
        Row: {
          billing_period: string
          cover_letter_limit: number
          created_at: string
          currency: string
          display_name: string
          is_active: boolean
          job_match_limit: number
          plan_code: string
          price_amount: number
          updated_at: string
        }
        Insert: {
          billing_period: string
          cover_letter_limit: number
          created_at?: string
          currency?: string
          display_name: string
          is_active?: boolean
          job_match_limit: number
          plan_code: string
          price_amount: number
          updated_at?: string
        }
        Update: {
          billing_period?: string
          cover_letter_limit?: number
          created_at?: string
          currency?: string
          display_name?: string
          is_active?: boolean
          job_match_limit?: number
          plan_code?: string
          price_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          country_of_residence: string | null
          created_at: string
          custom_major: string | null
          custom_university: string | null
          full_name: string | null
          id: string
          major: string | null
          major_id: string | null
          onboarding_completed_at: string | null
          role: string
          university: string | null
          university_id: string | null
          updated_at: string
        }
        Insert: {
          country_of_residence?: string | null
          created_at?: string
          custom_major?: string | null
          custom_university?: string | null
          full_name?: string | null
          id: string
          major?: string | null
          major_id?: string | null
          onboarding_completed_at?: string | null
          role?: string
          university?: string | null
          university_id?: string | null
          updated_at?: string
        }
        Update: {
          country_of_residence?: string | null
          created_at?: string
          custom_major?: string | null
          custom_university?: string | null
          full_name?: string | null
          id?: string
          major?: string | null
          major_id?: string | null
          onboarding_completed_at?: string | null
          role?: string
          university?: string | null
          university_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_country_of_residence_fkey"
            columns: ["country_of_residence"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "profiles_major_id_fkey"
            columns: ["major_id"]
            isOneToOne: false
            referencedRelation: "majors"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "profiles_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["slug"]
          },
        ]
      }
      subscriptions: {
        Row: {
          activated_at: string | null
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          expired_at: string | null
          id: string
          plan_code: string
          provider: string
          provider_customer_id: string | null
          provider_subscription_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          expired_at?: string | null
          id?: string
          plan_code: string
          provider: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          expired_at?: string | null
          id?: string
          plan_code?: string
          provider?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["plan_code"]
          },
        ]
      }
      target_roles: {
        Row: {
          category: string
          created_at: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      universities: {
        Row: {
          abbreviation: string | null
          country_code: string
          created_at: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          abbreviation?: string | null
          country_code?: string
          created_at?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          abbreviation?: string | null
          country_code?: string
          created_at?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "universities_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_subscription: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_plan_code: string
          p_provider: string
          p_provider_customer_id: string
          p_provider_subscription_id: string
          p_user_id: string
        }
        Returns: {
          activated_at: string | null
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          expired_at: string | null
          id: string
          plan_code: string
          provider: string
          provider_customer_id: string | null
          provider_subscription_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_cover_letter: {
        Args: { p_cover_letter_id: string }
        Returns: {
          approval_status: string
          approved_at: string | null
          approved_content: string | null
          created_at: string
          edited_content: string | null
          generated_content: string | null
          generation_status: string
          id: string
          match_id: string
          model_provider: string | null
          model_version: string | null
          revision: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "cover_letters"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_match: {
        Args: { p_match_id: string }
        Returns: {
          created_at: string
          cv_analysis_id: string
          decided_at: string | null
          explanation: string | null
          hard_filter_passed: boolean
          id: string
          job_id: string
          matching_model: string | null
          matching_version: string
          missing_skills: Json
          score: number
          score_breakdown: Json
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "matches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_subscription: {
        Args: { p_user_id: string }
        Returns: {
          activated_at: string | null
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          expired_at: string | null
          id: string
          plan_code: string
          provider: string
          provider_customer_id: string | null
          provider_subscription_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_cv_analysis: {
        Args: { p_analysis_id: string }
        Returns: {
          ai_model: string | null
          ai_provider: string | null
          analysis_task_id: string | null
          analysis_version: string
          analyzed_at: string | null
          approved_at: string | null
          career_recommendations: Json
          certifications: Json
          contact_info: Json | null
          created_at: string
          cv_id: string
          development_areas: Json
          education: Json
          error_message: string | null
          extracted_text: string | null
          id: string
          is_current: boolean
          languages: Json
          preference_snapshot: Json
          preferences_version: number | null
          professional_summary: string | null
          profile_level: string | null
          projects: Json
          recommendations_state: string
          recommended_roles: Json
          review_status: string
          reviewed_at: string | null
          search_focus: Json
          skills: Json
          status: string
          strongest_areas: Json
          superseded_at: string | null
          updated_at: string
          user_edits: Json | null
          user_id: string
          work_experience: Json
        }
        SetofOptions: {
          from: "*"
          to: "cv_analyses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_analysis_task: {
        Args: { p_cv_id: string; p_trigger: string; p_user_id: string }
        Returns: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          created_at: string
          cv_id: string
          failed_at: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          max_attempts: number
          preferences_version: number | null
          started_at: string | null
          status: string
          superseded_at: string | null
          task_type: string
          trigger: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "analysis_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_application: {
        Args: { p_match_id: string }
        Returns: {
          application_method: string
          approved_at: string
          approved_by: string
          cover_letter_id: string | null
          created_at: string
          id: string
          idempotency_key: string
          job_id: string
          last_attempt_at: string | null
          last_error: string | null
          match_id: string
          provider_message_id: string | null
          send_attempt_count: number
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_payment_attempt: {
        Args: { p_plan_code: string }
        Returns: {
          amount: number
          checkout_url: string | null
          created_at: string
          currency: string
          failure_code: string | null
          failure_message: string | null
          id: string
          idempotency_key: string
          metadata: Json | null
          plan_code: string
          provider: string
          provider_payment_id: string | null
          status: string
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "payment_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      expire_subscription: {
        Args: { p_user_id: string }
        Returns: {
          activated_at: string | null
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          expired_at: string | null
          id: string
          plan_code: string
          provider: string
          provider_customer_id: string | null
          provider_subscription_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_onboarding_readiness: { Args: never; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: {
          channel: string
          created_at: string
          id: string
          idempotency_key: string | null
          notification_type: string
          read_at: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          sent_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notifications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_payment_failed: {
        Args: {
          p_failure_code: string
          p_failure_message: string
          p_payment_attempt_id: string
          p_status: string
        }
        Returns: {
          amount: number
          checkout_url: string | null
          created_at: string
          currency: string
          failure_code: string | null
          failure_message: string | null
          id: string
          idempotency_key: string
          metadata: Json | null
          plan_code: string
          provider: string
          provider_payment_id: string | null
          status: string
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "payment_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_payment_verified: {
        Args: {
          p_payment_attempt_id: string
          p_period_end: string
          p_period_start: string
          p_provider_payment_id: string
        }
        Returns: {
          amount: number
          checkout_url: string | null
          created_at: string
          currency: string
          failure_code: string | null
          failure_message: string | null
          id: string
          idempotency_key: string
          metadata: Json | null
          plan_code: string
          provider: string
          provider_payment_id: string | null
          status: string
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "payment_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reject_match: {
        Args: { p_match_id: string }
        Returns: {
          created_at: string
          cv_analysis_id: string
          decided_at: string | null
          explanation: string | null
          hard_filter_passed: boolean
          id: string
          job_id: string
          matching_model: string | null
          matching_version: string
          missing_skills: Json
          score: number
          score_breakdown: Json
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "matches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      replace_cv: {
        Args: {
          p_file_name: string
          p_file_size_bytes: number
          p_mime_type: string
          p_storage_path: string
        }
        Returns: {
          created_at: string
          file_name: string
          file_size_bytes: number
          id: string
          is_active: boolean
          mime_type: string
          status: string
          storage_path: string
          superseded_at: string | null
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "cvs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_cover_letter_edit: {
        Args: { p_cover_letter_id: string; p_edited_content: string }
        Returns: {
          approval_status: string
          approved_at: string | null
          approved_content: string | null
          created_at: string
          edited_content: string | null
          generated_content: string | null
          generation_status: string
          id: string
          match_id: string
          model_provider: string | null
          model_version: string | null
          revision: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "cover_letters"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_job_preferences: {
        Args: {
          p_additional_notes: string
          p_custom_locations: string[]
          p_custom_target_roles: string[]
          p_experience_level: string
          p_job_market_coverage: string
          p_job_type: string
          p_location_ids: string[]
          p_target_role_ids: string[]
          p_work_arrangement: string
        }
        Returns: {
          additional_notes: string | null
          created_at: string
          custom_locations: string[] | null
          custom_target_roles: string[] | null
          experience_level: string | null
          id: string
          job_market_coverage: string | null
          job_type: string | null
          location: string | null
          target_roles: string | null
          updated_at: string
          user_id: string
          version: number
          work_arrangement: string | null
        }
        SetofOptions: {
          from: "*"
          to: "job_preferences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_cv_analysis_review: {
        Args: { p_analysis_id: string; p_user_edits: Json }
        Returns: {
          ai_model: string | null
          ai_provider: string | null
          analysis_task_id: string | null
          analysis_version: string
          analyzed_at: string | null
          approved_at: string | null
          career_recommendations: Json
          certifications: Json
          contact_info: Json | null
          created_at: string
          cv_id: string
          development_areas: Json
          education: Json
          error_message: string | null
          extracted_text: string | null
          id: string
          is_current: boolean
          languages: Json
          preference_snapshot: Json
          preferences_version: number | null
          professional_summary: string | null
          profile_level: string | null
          projects: Json
          recommendations_state: string
          recommended_roles: Json
          review_status: string
          reviewed_at: string | null
          search_focus: Json
          skills: Json
          status: string
          strongest_areas: Json
          superseded_at: string | null
          updated_at: string
          user_edits: Json | null
          user_id: string
          work_experience: Json
        }
        SetofOptions: {
          from: "*"
          to: "cv_analyses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

