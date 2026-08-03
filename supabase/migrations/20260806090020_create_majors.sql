-- majors: searchable, database-backed major/field-of-study reference data,
-- replacing the profiles.major free-text field going forward. Grouped by
-- a plain `category` text column (no separate categories table — the
-- category set is small and stable; a client groups options dynamically
-- by whatever distinct category values exist, so adding a new category
-- later needs no frontend change). "Other major / field of study" is a
-- UI-only sentinel, never a row here.
create table public.majors (
  slug text primary key,
  name text not null,
  category text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.majors is
  'Canonical major/field-of-study reference data, grouped by category. Client-readable, never client-writable.';

alter table public.majors enable row level security;

create trigger set_majors_updated_at
  before update on public.majors
  for each row
  execute function public.set_updated_at();

create policy "majors_select_authenticated"
  on public.majors
  for select
  to authenticated
  using (true);

grant select on public.majors to authenticated;
grant select, insert, update, delete on public.majors to service_role;

insert into public.majors (slug, name, category, sort_order) values
  ('computer-science', 'Computer Science', 'Computer Science and IT', 10),
  ('software-engineering', 'Software Engineering', 'Computer Science and IT', 20),
  ('information-technology', 'Information Technology', 'Computer Science and IT', 30),
  ('computer-engineering', 'Computer Engineering', 'Computer Science and IT', 40),
  ('data-science', 'Data Science', 'Computer Science and IT', 50),
  ('artificial-intelligence', 'Artificial Intelligence', 'Computer Science and IT', 60),
  ('cybersecurity', 'Cybersecurity', 'Computer Science and IT', 70),
  ('management-information-systems', 'Management Information Systems', 'Computer Science and IT', 80),
  ('electrical-engineering', 'Electrical Engineering', 'Engineering', 90),
  ('mechanical-engineering', 'Mechanical Engineering', 'Engineering', 100),
  ('civil-engineering', 'Civil Engineering', 'Engineering', 110),
  ('industrial-engineering', 'Industrial Engineering', 'Engineering', 120),
  ('business-administration', 'Business Administration', 'Business and Management', 130),
  ('human-resources', 'Human Resources', 'Business and Management', 140),
  ('accounting', 'Accounting', 'Finance and Accounting', 150),
  ('finance', 'Finance', 'Finance and Accounting', 160),
  ('marketing', 'Marketing', 'Marketing and Communications', 170),
  ('economics', 'Economics', 'Economics', 180),
  ('graphic-design', 'Graphic Design', 'Design and Creative Fields', 190),
  ('architecture', 'Architecture', 'Architecture', 200),
  ('nursing', 'Nursing', 'Healthcare and Life Sciences', 210),
  ('pharmacy', 'Pharmacy', 'Healthcare and Life Sciences', 220),
  ('biology', 'Biology', 'Healthcare and Life Sciences', 230),
  ('law', 'Law', 'Law and Political Science', 240),
  ('psychology', 'Psychology', 'Humanities and Social Sciences', 250),
  ('education', 'Education', 'Education', 260)
on conflict (slug) do nothing;
