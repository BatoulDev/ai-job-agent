-- Adds country_of_residence plus reference-backed university/major columns
-- to profiles, alongside the existing free-text university/major columns
-- (kept, never dropped — historical data is preserved exactly as written).
--
-- university_id/major_id are the trusted, structured values a searchable
-- combobox writes going forward. custom_university/custom_major hold the
-- "Other university" / "Other major" free-text entry, kept as a distinct
-- concept per AGENTS.md ("store custom values separately", "do not use
-- display labels as the only source of truth"). Both may be null (not yet
-- selected); at most one of the pair is ever set at a time.
--
-- country_of_residence deliberately starts null for every existing user —
-- never assumed to be Lebanon, per the explicit instruction not to invent
-- a match. Existing users must be asked to select it before it can gate
-- anything.
alter table public.profiles
  add column country_of_residence text references public.countries (code),
  add column university_id text references public.universities (slug),
  add column custom_university text,
  add column major_id text references public.majors (slug),
  add column custom_major text,
  add constraint profiles_university_single_source
    check (university_id is null or custom_university is null),
  add constraint profiles_major_single_source
    check (major_id is null or custom_major is null);

comment on column public.profiles.country_of_residence is
  'ISO 3166-1 alpha-2 code (see public.countries). Never assumed — null until the user explicitly selects it.';
comment on column public.profiles.university_id is
  'References public.universities.slug. Mutually exclusive with custom_university.';
comment on column public.profiles.custom_university is
  '"Other university" free-text entry. Mutually exclusive with university_id.';
comment on column public.profiles.major_id is
  'References public.majors.slug. Mutually exclusive with custom_major.';
comment on column public.profiles.custom_major is
  '"Other major" free-text entry. Mutually exclusive with major_id.';

-- One-time backfill: try a reliable, case-insensitive match of each
-- existing free-text profiles.university/major value against the new
-- reference tables (by name, and by abbreviation for universities).
-- Anything that matches gets the structured id; anything that does not
-- match is preserved verbatim as a custom value — never dropped, never
-- invented as a fabricated match.
update public.profiles p
set university_id = u.slug
from public.universities u
where p.university is not null
  and p.university_id is null
  and (lower(trim(p.university)) = lower(u.name) or lower(trim(p.university)) = lower(u.abbreviation));

update public.profiles p
set custom_university = p.university
where p.university is not null
  and p.university_id is null
  and p.custom_university is null;

update public.profiles p
set major_id = m.slug
from public.majors m
where p.major is not null
  and p.major_id is null
  and lower(trim(p.major)) = lower(m.name);

update public.profiles p
set custom_major = p.major
where p.major is not null
  and p.major_id is null
  and p.custom_major is null;
