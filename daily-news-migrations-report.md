# daily_news_briefs / daily_news_items — Production Migration Inspection
Read-only inspection of `ai-job-agent`. No files edited, no SQL executed, no production connection made.

## 1. Full migration inventory, in execution order

Supabase applies migrations in filename order (the leading timestamp is the sort key). There are **34 migration files** in `supabase/migrations/`. All 34 exist in the repo today; only the last two are the daily-news feature.

| # | Filename | Creates (one line) |
|---|---|---|
| 1 | `20260714153048_create_updated_at_function.sql` | `set_updated_at()` trigger function (shared by many tables below) |
| 2 | `20260714153051_create_profiles.sql` | `profiles` table, trigger, 2 policies |
| 3 | `20260714153055_create_job_preferences.sql` | `job_preferences` table, trigger, 4 policies |
| 4 | `20260714153058_create_cvs.sql` | `cvs` table, trigger, 4 policies |
| 5 | `20260714153102_handle_new_user_trigger.sql` | `handle_new_user()` function + `on_auth_user_created` trigger on `auth.users` |
| 6 | `20260714153105_create_cvs_storage_bucket.sql` | Storage bucket + 4 storage object policies |
| 7 | `20260718120000_grant_authenticated_table_access.sql` | Grants only (no new objects) |
| 8 | `20260802090000_create_plans.sql` | `plans` table, trigger, 1 policy |
| 9 | `20260802090010_create_subscriptions.sql` | `subscriptions` table, trigger, 1 policy, 4 functions, 1 auth trigger |
| 10 | `20260802090020_create_payment_attempts.sql` | `payment_attempts` table, index, trigger, 1 policy, 3 functions |
| 11 | `20260802090030_create_analysis_tasks.sql` | `analysis_tasks` table, 2 indexes, trigger, 1 policy, 1 function |
| 12 | `20260802090040_onboarding_readiness.sql` | `get_onboarding_readiness()` function |
| 13 | `20260803090000_allow_manual_test_subscription_provider.sql` | Alters 2 constraints on `subscriptions` (drop+recreate, schema-only) |
| 14 | `20260803090010_grant_service_role_table_access.sql` | Grants only |
| 15 | `20260804090000_extend_job_preferences_experience_level.sql` | Alters 1 constraint on `job_preferences` |
| 16 | `20260804090010_create_cv_analyses.sql` | `cv_analyses` table, unique index, 3 indexes, trigger, 1 policy |
| 17 | `20260805090000_add_job_preferences_versioning.sql` | `bump_job_preferences_version()` function + trigger |
| 18 | `20260805090010_add_cvs_versioning.sql` | Unique index on `cvs` |
| 19 | `20260805090020_extend_analysis_tasks_lifecycle.sql` | 1 function + trigger |
| 20 | `20260805090030_extend_cv_analyses_lifecycle.sql` | Unique index, 2 functions, 2 triggers |
| 21 | `20260806090000_create_countries.sql` | `countries` table, trigger, 1 policy |
| 22 | `20260806090010_create_universities.sql` | `universities` table, trigger, 1 policy |
| 23 | `20260806090020_create_majors.sql` | `majors` table, trigger, 1 policy |
| 24 | `20260806090030_create_target_roles.sql` | `target_roles` table, trigger, 1 policy |
| 25 | `20260806090040_create_locations.sql` | `locations` table, trigger, 1 policy |
| 26 | `20260806090050_extend_profiles_residence_and_references.sql` | Alters `profiles` (new columns/FKs) |
| 27 | `20260806090060_restructure_job_preferences_work_arrangement.sql` | Alters `job_preferences`, replaces 1 function |
| 28 | `20260806090070_create_job_preference_target_roles.sql` | `job_preference_target_roles` table, 3 policies, 1 function, trigger |
| 29 | `20260806090080_create_job_preference_locations.sql` | `job_preference_locations` table, 3 policies, trigger |
| 30 | `20260806090090_enforce_job_preferences_eligibility_trigger.sql` | 1 function + trigger |
| 31 | `20260806090100_create_save_job_preferences_rpc.sql` | `save_job_preferences()` RPC function |
| 32 | `20260806090110_update_onboarding_readiness_reference_preferences.sql` | Replaces `get_onboarding_readiness()` |
| 33 | `20260806090120_add_student_plan_residence_guard.sql` | Replaces `create_payment_attempt()` |
| 34a | **`20260807090000_create_daily_news_briefs.sql`** | **`daily_news_briefs` table, 1 policy, 1 index** |
| 34b | **`20260807090010_create_daily_news_items.sql`** | **`daily_news_items` table, 1 policy** |

**Important scope note:** none of the tooling available to me can inspect the actual current state of the production Supabase project (no `gh`/Supabase API access, no production credentials in this environment — by design, per your instructions). "Production is empty" is what you've told me; I cannot independently confirm whether that means *zero tables at all* or just *no daily-news data yet*. The two target migrations (34a/34b) are entirely self-contained (see §4) — if the rest of your production project already has the other 32 objects from separate prior provisioning, only 34a/34b need to run. If production is truly a blank project, all 34 are needed for the app to match this repo's intended schema. I'd confirm which situation you're in (e.g. `select table_name from information_schema.tables where table_schema='public'` in the SQL Editor) before choosing scope — that's a read-only query, not something I ran.

## 2. Full breakdown of the two target migrations

### `20260807090000_create_daily_news_briefs.sql`

**Table `public.daily_news_briefs`**
| Column | Type | Constraint |
|---|---|---|
| `id` | `uuid` | `primary key default gen_random_uuid()` |
| `brief_date` | `date` | `not null unique` |
| `is_published` | `boolean` | `not null default false` |
| `created_at` | `timestamptz` | `not null default now()` |

- **Table comment**: documents the publish-flag contract.
- **RLS**: enabled.
- **Policy** `daily_news_briefs_select_published_public`: `for select to anon, authenticated using (is_published = true)` — public readers only ever see published rows.
- **Grants**: `select` to `anon, authenticated`; `select, insert, update, delete` to `service_role`.
- **Index** `daily_news_briefs_published_date_idx`: partial index on `(brief_date desc) where is_published = true` — matches the website's actual query shape exactly.
- **Triggers**: none.
- **Constraints beyond the column-level ones above**: none (no FKs — this is the parent table).

### `20260807090010_create_daily_news_items.sql`

**Table `public.daily_news_items`**
| Column | Type | Constraint |
|---|---|---|
| `id` | `uuid` | `primary key default gen_random_uuid()` |
| `brief_id` | `uuid` | `not null references public.daily_news_briefs(id) on delete cascade` |
| `position` | `smallint` | `not null check (position between 1 and 5)` |
| `headline` | `text` | `not null check (char_length(headline) between 1 and 200)` |
| `summary` | `text` | `not null check (char_length(summary) between 1 and 600)` |
| `source_url` | `text` | nullable, no constraint |
| `created_at` | `timestamptz` | `not null default now()` |
| — | — | `unique (brief_id, position)` (table-level) |

- **Table comment**: documents that `source_url` is internal-only.
- **RLS**: enabled.
- **Policy** `daily_news_items_select_published_public`: `for select to anon, authenticated using (exists (select 1 from public.daily_news_briefs b where b.id = daily_news_items.brief_id and b.is_published = true))` — visibility follows the parent's publish state, no denormalized status needed.
- **Grants**: **column-level** `select (id, brief_id, position, headline, summary, created_at)` to `anon, authenticated` — `source_url` is deliberately excluded from the public grant (DB-enforced, not just a frontend convention); `select, insert, update, delete` to `service_role`.
- **Triggers**: none.
- **Foreign key**: `brief_id → daily_news_briefs.id`, `on delete cascade`.

## 3. Safety on an empty production project

Both files use plain `create table` / `create policy` / `create index` (no `if not exists`). On a **genuinely empty** project (these two tables don't exist yet) this is completely safe: nothing gets overwritten or lost, since there's nothing there to collide with. There is no `DROP`, `TRUNCATE`, or unscoped `DELETE` anywhere in either file (confirmed below in §7).

The one sharp edge: **these statements are not idempotent.** If you (or a later automated `supabase db push`) ever try to run either file a second time against a project where it already succeeded, `create table public.daily_news_briefs` will error with "relation already exists" — not destructive, just a hard stop. That's a normal Supabase-migration property, not a defect specific to these two files, but worth knowing before a re-run.

## 4. Dependencies

- **34a and 34b depend on each other, in this order only**: `daily_news_items.brief_id` has a foreign key to `daily_news_briefs.id`, so **34a (briefs) must run before 34b (items)**. Running them in reverse order fails immediately at the `references` clause.
- **Neither depends on any of the other 32 migrations.** I checked specifically for:
  - Foreign keys to any other table (`profiles`, `auth.users`, etc.) — none exist in either file.
  - Use of the shared `set_updated_at()` trigger function from migration #1 — not used; these tables only have `created_at`, no `updated_at` column or trigger.
  - Any custom function/trigger defined elsewhere — none referenced.
  - The only external dependency is `gen_random_uuid()`, which isn't created by any migration in this repo — it relies on the `pgcrypto` extension, which every standard Supabase project has enabled by default at provisioning time (confirmed it's already relied on unconditionally, with no `create extension` statement, in 7 other pre-existing migrations too — `job_preferences`, `cvs`, `subscriptions`, `payment_attempts`, `analysis_tasks`, `cv_analyses` all do the same).
  - `anon`, `authenticated`, `service_role` roles used in the grants are built-in Supabase platform roles, not created by any migration.

**Conclusion**: if your only goal is to unblock the daily-news feature, running **just 34a then 34b** is fully sufficient and correct on their own — you do not need the other 32 for these two tables to work.

## 5. Safest way to apply via the Supabase SQL Editor

1. Open the **production** project (double-check the project ref/URL in the address bar before doing anything — easy to mix up with a staging project).
2. **SQL Editor → New query.**
3. Paste **only the two files' contents, briefs first then items** (§6 below), as a single script or as two separate runs — either is safe given the FK ordering is respected.
4. Before running, use **"Explain"/dry inspection is not available for DDL in the editor**, so instead do a quick read-only pre-check in a separate query first:
   ```sql
   select table_name from information_schema.tables
   where table_schema = 'public' and table_name in ('daily_news_briefs', 'daily_news_items');
   ```
   Confirm this returns **zero rows** before proceeding — if it returns any rows, stop and tell me, since that means the tables already exist and pasting `create table` will error (harmlessly, but worth knowing in advance).
5. Run the script. Supabase's SQL Editor runs the whole pasted script as a single transaction by default, so if anything errors partway, the whole thing rolls back — nothing is left half-created.
6. Afterward, verify with a read-only check:
   ```sql
   select * from public.daily_news_briefs limit 1;
   select * from public.daily_news_items limit 1;
   ```
   (Both should return zero rows, no error.)
7. Separately — and this is not part of these two files — you still need the **`ai-tech-daily-news` GitHub Actions secrets** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) to point at this same production project before a real automation run can write to it.

## 6. Exact SQL to paste, in order

**Step A — `20260807090000_create_daily_news_briefs.sql` (run first):**

```sql
-- daily_news_briefs: one row per day the ai-tech-daily-news automation
-- successfully produced a validated brief.
--
-- is_published flips to true only after all of that day's items were
-- written successfully (see daily_news_items) — this is what "published"
-- means for RLS purposes, so a partially-written day is never visible to
-- public readers. Written only by the automation's service-role client.
create table public.daily_news_briefs (
  id uuid primary key default gen_random_uuid(),
  brief_date date not null unique,
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.daily_news_briefs is
  'One row per day. is_published flips to true only after all items for the day were written successfully. Written only by the ai-tech-daily-news service-role automation. Client-readable (published rows only), never client-writable.';

alter table public.daily_news_briefs enable row level security;

-- Narrowly scoped: public readers (logged in or not) see published rows
-- only, never drafts.
create policy "daily_news_briefs_select_published_public"
  on public.daily_news_briefs
  for select
  to anon, authenticated
  using (is_published = true);

grant select on public.daily_news_briefs to anon, authenticated;
grant select, insert, update, delete on public.daily_news_briefs to service_role;

-- Matches the actual "latest 5 published briefs" query
-- (order by brief_date desc limit 5, where is_published = true) exactly —
-- small, cheap, and skips every draft/unpublished row entirely.
create index daily_news_briefs_published_date_idx
  on public.daily_news_briefs (brief_date desc)
  where is_published = true;
```

**Step B — `20260807090010_create_daily_news_items.sql` (run second, after Step A succeeds):**

```sql
-- daily_news_items: up to 5 items per daily_news_briefs row.
--
-- source_url is stored for internal admin verification only — excluded
-- from the public column grant below and never rendered as a link by the
-- website. Visible to public readers only when the parent brief is
-- published (see the exists() policy below).
create table public.daily_news_items (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references public.daily_news_briefs(id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  headline text not null check (char_length(headline) between 1 and 200),
  summary text not null check (char_length(summary) between 1 and 600),
  source_url text,
  created_at timestamptz not null default now(),
  unique (brief_id, position)
);

comment on table public.daily_news_items is
  'Up to 5 items per daily_news_briefs row. source_url is internal-only (admin verification), excluded from the public column grant and never rendered as a link. Visible to public readers only when the parent brief is published.';

alter table public.daily_news_items enable row level security;

-- Visibility follows the parent brief's publish state — no denormalized
-- status column needed on this small child table.
create policy "daily_news_items_select_published_public"
  on public.daily_news_items
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.daily_news_briefs b
      where b.id = daily_news_items.brief_id
        and b.is_published = true
    )
  );

-- Column-level grant deliberately omits source_url: DB-enforced
-- "internal-only" rather than relying on the frontend simply choosing not
-- to select it.
grant select (id, brief_id, position, headline, summary, created_at)
  on public.daily_news_items to anon, authenticated;
grant select, insert, update, delete on public.daily_news_items to service_role;
```

No secrets, credentials, or environment-specific values appear anywhere in this SQL — it's schema-only DDL.

## 7. Destructive-command confirmation

I grepped both target files (and, for full transparency, all 34 migrations) for `DROP`, `TRUNCATE`, and unscoped `DELETE`:

- **`20260807090000_create_daily_news_briefs.sql`**: zero matches.
- **`20260807090010_create_daily_news_items.sql`**: zero matches.
- Across the other 32 files: the only hits are (a) `alter table ... drop constraint` in 4 unrelated migrations — schema-only, dropping a *constraint definition* they immediately replace, not data; and (b) two `delete from job_preference_target_roles/locations where job_preference_id = v_row.id` lines *inside* the body of the `save_job_preferences()` RPC function (`20260806090100`) — that's an application-level function replacing one user's own preference rows on their own request, not migration-time data deletion, and it's unrelated to the daily-news tables entirely.

**Confirmed: the SQL in §6 (and the daily-news migrations as a pair) contains no `DROP`, `TRUNCATE`, or `DELETE` of any kind.**

---

Nothing was executed, connected to production, edited, committed, or pushed during this inspection. Waiting for your review before taking any action.
