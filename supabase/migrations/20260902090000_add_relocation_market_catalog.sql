-- Extends the existing canonical public.locations catalog (the same table
-- already used for Lebanese on-site/hybrid "Preferred job locations") with
-- the initial set of Pro-only relocation markets (AGENTS.md task: "Target
-- Gulf relocation locations" — Saudi Arabia, Qatar, Kuwait, and three
-- structured UAE options). Deliberately reuses public.locations rather
-- than introducing a second, parallel location table — a future market
-- addition is one row in one canonical catalog, not a change scattered
-- across UI/API files.
--
-- is_relocation_market is a plain boolean flag distinguishing "a Lebanese
-- physical-location option for job_preference_locations" (is_relocation_
-- market = false, the existing 11 rows) from "a Gulf relocation option for
-- job_preference_relocation_locations" (true, the 6 rows added below).
-- Both subsets share one slug namespace, one is_active flag, and one
-- admin/service-role write path — never two catalogs to keep in sync.
--
-- Dubai/Abu Dhabi are modeled as structured locations under country_code
-- 'AE', not as countries themselves, per the explicit instruction not to
-- model cities as countries. "Anywhere in the UAE" is a third, distinct
-- location row (not a synonym for the country) so a user can express "the
-- whole UAE" without it being confused with "Dubai specifically."
alter table public.locations
  add column is_relocation_market boolean not null default false;

comment on column public.locations.is_relocation_market is
  'true for a Pro-only relocation market (job_preference_relocation_locations); false for the existing Lebanese on-site/hybrid catalog (job_preference_locations). One shared slug/catalog, two disjoint subsets — never mix a relocation-market slug into job_preference_locations or vice versa (enforced in save_job_preferences).';

insert into public.locations (slug, name, country_code, is_relocation_market, sort_order) values
  ('saudi-arabia', 'Saudi Arabia', 'SA', true, 1010),
  ('qatar', 'Qatar', 'QA', true, 1020),
  ('kuwait', 'Kuwait', 'KW', true, 1030),
  ('uae-dubai', 'Dubai, United Arab Emirates', 'AE', true, 1040),
  ('uae-abu-dhabi', 'Abu Dhabi, United Arab Emirates', 'AE', true, 1050),
  ('uae-anywhere', 'Anywhere in the UAE', 'AE', true, 1060)
on conflict (slug) do nothing;

-- location_nearby_areas: a small, explicit, deterministic adjacency
-- mapping between real Lebanese cities (never the 'anywhere-in-lebanon'
-- sentinel row, which already means "no city restriction" on its own).
-- This is the only mapping "selected_and_nearby" (see the
-- job_preferences.lebanon_location_scope column added in the next
-- migration) is allowed to use — AI/LLM proximity is never used here per
-- explicit instruction ("do not let AI invent proximity"). The mapping is
-- a simple, symmetric, hand-reviewed adjacency graph over the 10 existing
-- Lebanese city rows, not a distance calculation — it is intentionally
-- conservative (e.g. Beirut is adjacent to Mount Lebanon and Jounieh, but
-- not to Tripoli or Tyre). Product should review/extend this table if the
-- mapping needs to change; it is data, not code, so a future adjustment
-- is a reviewed migration, never a source-code change.
create table public.location_nearby_areas (
  location_id text not null references public.locations (slug),
  nearby_location_id text not null references public.locations (slug),
  created_at timestamptz not null default now(),
  primary key (location_id, nearby_location_id),
  constraint location_nearby_areas_not_self check (location_id <> nearby_location_id)
);

comment on table public.location_nearby_areas is
  'Deterministic, hand-authored adjacency mapping between Lebanese cities, used only when job_preferences.lebanon_location_scope = ''selected_and_nearby''. Symmetric by convention (both directions inserted explicitly) and reference data only — client-readable, never client-writable.';

alter table public.location_nearby_areas enable row level security;

create policy "location_nearby_areas_select_authenticated"
  on public.location_nearby_areas
  for select
  to authenticated
  using (true);

grant select on public.location_nearby_areas to authenticated;
grant select, insert, update, delete on public.location_nearby_areas to service_role;

-- Symmetric adjacency pairs (both directions inserted explicitly so a
-- lookup never needs an OR'd bidirectional query).
insert into public.location_nearby_areas (location_id, nearby_location_id) values
  ('beirut', 'mount-lebanon'), ('mount-lebanon', 'beirut'),
  ('beirut', 'jounieh'), ('jounieh', 'beirut'),
  ('mount-lebanon', 'jounieh'), ('jounieh', 'mount-lebanon'),
  ('mount-lebanon', 'byblos-jbeil'), ('byblos-jbeil', 'mount-lebanon'),
  ('jounieh', 'byblos-jbeil'), ('byblos-jbeil', 'jounieh'),
  ('byblos-jbeil', 'tripoli'), ('tripoli', 'byblos-jbeil'),
  ('sidon-saida', 'tyre-sour'), ('tyre-sour', 'sidon-saida'),
  ('tyre-sour', 'nabatieh'), ('nabatieh', 'tyre-sour'),
  ('sidon-saida', 'nabatieh'), ('nabatieh', 'sidon-saida'),
  ('zahle', 'baalbek'), ('baalbek', 'zahle')
on conflict (location_id, nearby_location_id) do nothing;
