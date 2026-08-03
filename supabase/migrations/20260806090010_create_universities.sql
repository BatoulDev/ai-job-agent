-- universities: searchable, database-backed university reference data,
-- replacing the profiles.university free-text field going forward.
--
-- slug is a stable, human-readable id (never renumbered) — same "text
-- primary key as stable code" convention as public.plans.country_code
-- defaults to Lebanon since this seed is Lebanon-focused, but the column
-- exists precisely so international universities can be added later
-- without any frontend change. "Other university" is deliberately NOT a
-- row here — it is a UI-only sentinel value that routes to
-- profiles.custom_university instead of university_id.
create table public.universities (
  slug text primary key,
  name text not null,
  abbreviation text,
  country_code text not null default 'LB' references public.countries (code),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.universities is
  'Canonical university reference data. Client-readable, never client-writable. "Other university" is a UI sentinel, never a row here.';

alter table public.universities enable row level security;

create trigger set_universities_updated_at
  before update on public.universities
  for each row
  execute function public.set_updated_at();

create policy "universities_select_authenticated"
  on public.universities
  for select
  to authenticated
  using (true);

grant select on public.universities to authenticated;
grant select, insert, update, delete on public.universities to service_role;

insert into public.universities (slug, name, abbreviation, sort_order) values
  ('lebanese-university', 'Lebanese University', 'LU', 10),
  ('american-university-of-beirut', 'American University of Beirut', 'AUB', 20),
  ('lebanese-american-university', 'Lebanese American University', 'LAU', 30),
  ('beirut-arab-university', 'Beirut Arab University', 'BAU', 40),
  ('saint-joseph-university-of-beirut', 'Saint Joseph University of Beirut', 'USJ', 50),
  ('holy-spirit-university-of-kaslik', 'Holy Spirit University of Kaslik', 'USEK', 60),
  ('university-of-balamand', 'University of Balamand', 'UOB', 70),
  ('notre-dame-university-louaize', 'Notre Dame University–Louaize', 'NDU', 80),
  ('lebanese-international-university', 'Lebanese International University', 'LIU', 90),
  ('american-university-of-science-and-technology', 'American University of Science and Technology', 'AUST', 100),
  ('antonine-university', 'Antonine University', 'UA', 110),
  ('arab-open-university-lebanon', 'Arab Open University – Lebanon', 'AOU', 120),
  ('haigazian-university', 'Haigazian University', null, 130),
  ('islamic-university-of-lebanon', 'Islamic University of Lebanon', 'IUL', 140),
  ('jinan-university', 'Jinan University', null, 150),
  ('modern-university-for-business-and-science', 'Modern University for Business and Science', 'MUBS', 160),
  ('al-maaref-university', 'Al Maaref University', null, 170),
  ('global-university', 'Global University', null, 180)
on conflict (slug) do nothing;
