-- countries: canonical, trusted country-of-residence reference data.
--
-- Stable ISO 3166-1 alpha-2 codes are the source of truth (never a display
-- label) — profiles.country_of_residence and locations.country_code will
-- reference this table's code column. Lebanon ('LB') is the pivot value
-- the whole plan-eligibility/job-market-coverage feature branches on.
--
-- Read-only reference data, same pattern as public.plans: RLS select-only
-- for authenticated, no insert/update/delete policy for any client role.
create table public.countries (
  code text primary key,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.countries is
  'Canonical ISO 3166-1 alpha-2 country reference data. Client-readable, never client-writable.';

alter table public.countries enable row level security;

create trigger set_countries_updated_at
  before update on public.countries
  for each row
  execute function public.set_updated_at();

create policy "countries_select_authenticated"
  on public.countries
  for select
  to authenticated
  using (true);

grant select on public.countries to authenticated;
grant select, insert, update, delete on public.countries to service_role;

insert into public.countries (code, name) values
  ('AF', 'Afghanistan'), ('AL', 'Albania'), ('DZ', 'Algeria'), ('AD', 'Andorra'),
  ('AO', 'Angola'), ('AG', 'Antigua and Barbuda'), ('AR', 'Argentina'), ('AM', 'Armenia'),
  ('AU', 'Australia'), ('AT', 'Austria'), ('AZ', 'Azerbaijan'),
  ('BS', 'Bahamas'), ('BH', 'Bahrain'), ('BD', 'Bangladesh'), ('BB', 'Barbados'),
  ('BY', 'Belarus'), ('BE', 'Belgium'), ('BZ', 'Belize'), ('BJ', 'Benin'), ('BT', 'Bhutan'),
  ('BO', 'Bolivia'), ('BA', 'Bosnia and Herzegovina'), ('BW', 'Botswana'), ('BR', 'Brazil'),
  ('BN', 'Brunei'), ('BG', 'Bulgaria'), ('BF', 'Burkina Faso'), ('BI', 'Burundi'),
  ('CV', 'Cabo Verde'), ('KH', 'Cambodia'), ('CM', 'Cameroon'), ('CA', 'Canada'),
  ('CF', 'Central African Republic'), ('TD', 'Chad'), ('CL', 'Chile'), ('CN', 'China'),
  ('CO', 'Colombia'), ('KM', 'Comoros'), ('CG', 'Congo (Republic of the)'),
  ('CD', 'Congo (Democratic Republic of the)'), ('CR', 'Costa Rica'), ('HR', 'Croatia'),
  ('CU', 'Cuba'), ('CY', 'Cyprus'), ('CZ', 'Czechia'),
  ('DK', 'Denmark'), ('DJ', 'Djibouti'), ('DM', 'Dominica'), ('DO', 'Dominican Republic'),
  ('EC', 'Ecuador'), ('EG', 'Egypt'), ('SV', 'El Salvador'), ('GQ', 'Equatorial Guinea'),
  ('ER', 'Eritrea'), ('EE', 'Estonia'), ('SZ', 'Eswatini'), ('ET', 'Ethiopia'),
  ('FJ', 'Fiji'), ('FI', 'Finland'), ('FR', 'France'),
  ('GA', 'Gabon'), ('GM', 'Gambia'), ('GE', 'Georgia'), ('DE', 'Germany'), ('GH', 'Ghana'),
  ('GR', 'Greece'), ('GD', 'Grenada'), ('GT', 'Guatemala'), ('GN', 'Guinea'),
  ('GW', 'Guinea-Bissau'), ('GY', 'Guyana'),
  ('HT', 'Haiti'), ('HN', 'Honduras'), ('HU', 'Hungary'),
  ('IS', 'Iceland'), ('IN', 'India'), ('ID', 'Indonesia'), ('IR', 'Iran'), ('IQ', 'Iraq'),
  ('IE', 'Ireland'), ('IL', 'Israel'), ('IT', 'Italy'), ('CI', 'Ivory Coast'),
  ('JM', 'Jamaica'), ('JP', 'Japan'), ('JO', 'Jordan'),
  ('KZ', 'Kazakhstan'), ('KE', 'Kenya'), ('KI', 'Kiribati'), ('XK', 'Kosovo'),
  ('KW', 'Kuwait'), ('KG', 'Kyrgyzstan'),
  ('LA', 'Laos'), ('LV', 'Latvia'), ('LB', 'Lebanon'), ('LS', 'Lesotho'), ('LR', 'Liberia'),
  ('LY', 'Libya'), ('LI', 'Liechtenstein'), ('LT', 'Lithuania'), ('LU', 'Luxembourg'),
  ('MG', 'Madagascar'), ('MW', 'Malawi'), ('MY', 'Malaysia'), ('MV', 'Maldives'),
  ('ML', 'Mali'), ('MT', 'Malta'), ('MH', 'Marshall Islands'), ('MR', 'Mauritania'),
  ('MU', 'Mauritius'), ('MX', 'Mexico'), ('FM', 'Micronesia'), ('MD', 'Moldova'),
  ('MC', 'Monaco'), ('MN', 'Mongolia'), ('ME', 'Montenegro'), ('MA', 'Morocco'),
  ('MZ', 'Mozambique'), ('MM', 'Myanmar'),
  ('NA', 'Namibia'), ('NR', 'Nauru'), ('NP', 'Nepal'), ('NL', 'Netherlands'),
  ('NZ', 'New Zealand'), ('NI', 'Nicaragua'), ('NE', 'Niger'), ('NG', 'Nigeria'),
  ('KP', 'North Korea'), ('MK', 'North Macedonia'), ('NO', 'Norway'),
  ('OM', 'Oman'),
  ('PK', 'Pakistan'), ('PW', 'Palau'), ('PS', 'Palestine'), ('PA', 'Panama'),
  ('PG', 'Papua New Guinea'), ('PY', 'Paraguay'), ('PE', 'Peru'), ('PH', 'Philippines'),
  ('PL', 'Poland'), ('PT', 'Portugal'),
  ('QA', 'Qatar'),
  ('RO', 'Romania'), ('RU', 'Russia'), ('RW', 'Rwanda'),
  ('KN', 'Saint Kitts and Nevis'), ('LC', 'Saint Lucia'),
  ('VC', 'Saint Vincent and the Grenadines'), ('WS', 'Samoa'), ('SM', 'San Marino'),
  ('ST', 'Sao Tome and Principe'), ('SA', 'Saudi Arabia'), ('SN', 'Senegal'),
  ('RS', 'Serbia'), ('SC', 'Seychelles'), ('SL', 'Sierra Leone'), ('SG', 'Singapore'),
  ('SK', 'Slovakia'), ('SI', 'Slovenia'), ('SB', 'Solomon Islands'), ('SO', 'Somalia'),
  ('ZA', 'South Africa'), ('KR', 'South Korea'), ('SS', 'South Sudan'), ('ES', 'Spain'),
  ('LK', 'Sri Lanka'), ('SD', 'Sudan'), ('SR', 'Suriname'), ('SE', 'Sweden'),
  ('CH', 'Switzerland'), ('SY', 'Syria'),
  ('TW', 'Taiwan'), ('TJ', 'Tajikistan'), ('TZ', 'Tanzania'), ('TH', 'Thailand'),
  ('TL', 'Timor-Leste'), ('TG', 'Togo'), ('TO', 'Tonga'), ('TT', 'Trinidad and Tobago'),
  ('TN', 'Tunisia'), ('TR', 'Turkey'), ('TM', 'Turkmenistan'), ('TV', 'Tuvalu'),
  ('UG', 'Uganda'), ('UA', 'Ukraine'), ('AE', 'United Arab Emirates'),
  ('GB', 'United Kingdom'), ('US', 'United States'), ('UY', 'Uruguay'), ('UZ', 'Uzbekistan'),
  ('VU', 'Vanuatu'), ('VA', 'Vatican City'), ('VE', 'Venezuela'), ('VN', 'Vietnam'),
  ('YE', 'Yemen'),
  ('ZM', 'Zambia'), ('ZW', 'Zimbabwe')
on conflict (code) do nothing;

-- Alphabetical sort_order so a client can render a stable, predictable
-- list without re-sorting 195 rows on every page load.
update public.countries c
set sort_order = t.rn
from (
  select code, row_number() over (order by name) as rn
  from public.countries
) t
where c.code = t.code;
