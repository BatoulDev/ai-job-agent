-- Extends job_preferences.experience_level with three more options
-- (mid-level, senior, open-to-all) alongside the three that already exist
-- (internship, entry-level, junior). Values are lowercase, hyphen-separated
-- text — matching the existing convention on this exact column
-- (job_preferences_experience_level_check originally used 'entry-level',
-- not 'entry_level') and on remote_preference/job_type, not the
-- underscore convention. Do not introduce a second naming style here.
--
-- Existing stored rows only ever contain the original three values, all of
-- which remain valid under the new, wider constraint — no data migration
-- is needed and no existing row can become invalid.
alter table public.job_preferences
  drop constraint job_preferences_experience_level_check;

alter table public.job_preferences
  add constraint job_preferences_experience_level_check
  check (experience_level in (
    'internship',
    'entry-level',
    'junior',
    'mid-level',
    'senior',
    'open-to-all'
  ));
