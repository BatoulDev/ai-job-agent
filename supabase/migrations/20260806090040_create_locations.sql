-- locations: searchable, database-backed physical-location reference data
-- for the "Preferred job locations" control (shown only for Lebanon-based
-- users choosing On-site/Hybrid/Flexible). Names are pre-normalized (e.g.
-- "Sidon / Saida, Lebanon") so nothing inconsistent like "saida,lebanon"
-- can ever be stored. country_code exists so non-Lebanon locations could
-- be added later without a frontend change, even though this MVP only
-- supports Lebanon on-site/hybrid coverage. "Other location" is a UI-only
-- sentinel, never a row here — custom entries live in
-- job_preferences.custom_locations.
create table public.locations (
  slug text primary key,
  name text not null,
  country_code text not null default 'LB' references public.countries (code),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.locations is
  'Canonical physical-location reference data (pre-normalized display names). Client-readable, never client-writable.';

alter table public.locations enable row level security;

create trigger set_locations_updated_at
  before update on public.locations
  for each row
  execute function public.set_updated_at();

create policy "locations_select_authenticated"
  on public.locations
  for select
  to authenticated
  using (true);

grant select on public.locations to authenticated;
grant select, insert, update, delete on public.locations to service_role;

insert into public.locations (slug, name, sort_order) values
  ('beirut', 'Beirut, Lebanon', 10),
  ('mount-lebanon', 'Mount Lebanon, Lebanon', 20),
  ('jounieh', 'Jounieh, Lebanon', 30),
  ('byblos-jbeil', 'Byblos / Jbeil, Lebanon', 40),
  ('tripoli', 'Tripoli, Lebanon', 50),
  ('sidon-saida', 'Sidon / Saida, Lebanon', 60),
  ('tyre-sour', 'Tyre / Sour, Lebanon', 70),
  ('zahle', 'Zahle, Lebanon', 80),
  ('baalbek', 'Baalbek, Lebanon', 90),
  ('nabatieh', 'Nabatieh, Lebanon', 100),
  ('anywhere-in-lebanon', 'Anywhere in Lebanon', 110)
on conflict (slug) do nothing;
