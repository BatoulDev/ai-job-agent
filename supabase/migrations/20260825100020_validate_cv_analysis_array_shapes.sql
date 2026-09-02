-- Automation-1 audit fix (Phase 4 of the 8-item fix order, DB half): no
-- runtime schema validation existed for AI-output array columns before
-- insert. n8n-workflows/cv-analysis-worker.ts's safeArr() only checked
-- Array.isArray(), never element type. Reproduced live during the audit: a
-- cv_analyses row with a non-string element in career_recommendations
-- (an object instead of a string) was accepted by the database and crashed
-- the entire CV Profile page to a full error boundary on render — the
-- malformed shape was never rejected anywhere in the pipeline.
--
-- This adds a database-level backstop (defense in depth, AGENTS.md §20):
-- even if the n8n worker's own validation (added in this same fix, see the
-- worker source) has a bug or is bypassed by a future direct insert, a
-- malformed array can never be stored as a completed analysis. The
-- frontend fix (defensive rendering) is a second, independent layer for
-- any row that predates this constraint.
create or replace function public.jsonb_is_string_array(v jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(v) = 'array'
     and not exists (
       select 1 from jsonb_array_elements(v) as elem
       where jsonb_typeof(elem) <> 'string'
     );
$$;

comment on function public.jsonb_is_string_array(jsonb) is
  'True only when v is a JSON array whose every element is a JSON string. Used to validate AI-output string[] columns before insert.';

create or replace function public.jsonb_is_object_array(v jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(v) = 'array'
     and not exists (
       select 1 from jsonb_array_elements(v) as elem
       where jsonb_typeof(elem) <> 'object'
     );
$$;

comment on function public.jsonb_is_object_array(jsonb) is
  'True only when v is a JSON array whose every element is a JSON object. Used to validate AI-output object[] columns before insert.';

alter table public.cv_analyses
  add constraint cv_analyses_skills_elements_check
    check (public.jsonb_is_string_array(skills)),
  add constraint cv_analyses_strongest_areas_elements_check
    check (public.jsonb_is_string_array(strongest_areas)),
  add constraint cv_analyses_recommended_roles_elements_check
    check (public.jsonb_is_string_array(recommended_roles)),
  add constraint cv_analyses_career_recommendations_elements_check
    check (public.jsonb_is_string_array(career_recommendations)),
  add constraint cv_analyses_search_focus_elements_check
    check (public.jsonb_is_string_array(search_focus)),
  add constraint cv_analyses_development_areas_elements_check
    check (public.jsonb_is_string_array(development_areas)),
  add constraint cv_analyses_education_elements_check
    check (public.jsonb_is_object_array(education)),
  add constraint cv_analyses_work_experience_elements_check
    check (public.jsonb_is_object_array(work_experience)),
  add constraint cv_analyses_projects_elements_check
    check (public.jsonb_is_object_array(projects)),
  add constraint cv_analyses_certifications_elements_check
    check (public.jsonb_is_object_array(certifications)),
  add constraint cv_analyses_languages_elements_check
    check (public.jsonb_is_object_array(languages));
