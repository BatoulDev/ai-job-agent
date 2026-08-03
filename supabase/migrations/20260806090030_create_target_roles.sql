-- target_roles: searchable, database-backed target-role reference data,
-- replacing the job_preferences.target_roles single free-text field. Many-
-- to-many with job_preferences via job_preference_target_roles (see
-- 20260806090070). Grouped by a plain `category` text column, same
-- rationale as majors.category. "Other role" is a UI-only sentinel, never
-- a row here — custom entries live in job_preferences.custom_target_roles.
create table public.target_roles (
  slug text primary key,
  name text not null,
  category text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.target_roles is
  'Canonical target-role reference data, grouped by category. Client-readable, never client-writable.';

alter table public.target_roles enable row level security;

create trigger set_target_roles_updated_at
  before update on public.target_roles
  for each row
  execute function public.set_updated_at();

create policy "target_roles_select_authenticated"
  on public.target_roles
  for select
  to authenticated
  using (true);

grant select on public.target_roles to authenticated;
grant select, insert, update, delete on public.target_roles to service_role;

insert into public.target_roles (slug, name, category, sort_order) values
  ('frontend-developer', 'Frontend Developer', 'Technology', 10),
  ('backend-developer', 'Backend Developer', 'Technology', 20),
  ('full-stack-developer', 'Full-Stack Developer', 'Technology', 30),
  ('software-engineer', 'Software Engineer', 'Technology', 40),
  ('mobile-developer', 'Mobile Developer', 'Technology', 50),
  ('qa-engineer', 'QA Engineer', 'Technology', 60),
  ('it-support-specialist', 'IT Support Specialist', 'Technology', 70),
  ('data-analyst', 'Data Analyst', 'Technology', 80),
  ('data-scientist', 'Data Scientist', 'Technology', 90),
  ('ai-ml-engineer', 'AI / Machine Learning Engineer', 'Technology', 100),
  ('cybersecurity-analyst', 'Cybersecurity Analyst', 'Technology', 110),
  ('ui-ux-designer', 'UI/UX Designer', 'Technology', 120),
  ('product-manager', 'Product Manager', 'Technology', 130),
  ('business-analyst', 'Business Analyst', 'Business and Finance', 140),
  ('financial-analyst', 'Financial Analyst', 'Business and Finance', 150),
  ('accountant', 'Accountant', 'Business and Finance', 160),
  ('auditor', 'Auditor', 'Business and Finance', 170),
  ('sales-representative', 'Sales Representative', 'Business and Finance', 180),
  ('business-development-associate', 'Business Development Associate', 'Business and Finance', 190),
  ('operations-coordinator', 'Operations Coordinator', 'Business and Finance', 200),
  ('human-resources-assistant', 'Human Resources Assistant', 'Business and Finance', 210),
  ('project-coordinator', 'Project Coordinator', 'Business and Finance', 220),
  ('digital-marketing-specialist', 'Digital Marketing Specialist', 'Marketing and Creative', 230),
  ('social-media-specialist', 'Social Media Specialist', 'Marketing and Creative', 240),
  ('content-writer', 'Content Writer', 'Marketing and Creative', 250),
  ('copywriter', 'Copywriter', 'Marketing and Creative', 260),
  ('graphic-designer', 'Graphic Designer', 'Marketing and Creative', 270),
  ('marketing-coordinator', 'Marketing Coordinator', 'Marketing and Creative', 280),
  ('seo-specialist', 'SEO Specialist', 'Marketing and Creative', 290),
  ('civil-engineer', 'Civil Engineer', 'Engineering and Other', 300),
  ('mechanical-engineer', 'Mechanical Engineer', 'Engineering and Other', 310),
  ('electrical-engineer', 'Electrical Engineer', 'Engineering and Other', 320),
  ('architect', 'Architect', 'Engineering and Other', 330),
  ('customer-support-representative', 'Customer Support Representative', 'Engineering and Other', 340),
  ('administrative-assistant', 'Administrative Assistant', 'Engineering and Other', 350),
  ('research-assistant', 'Research Assistant', 'Engineering and Other', 360)
on conflict (slug) do nothing;
