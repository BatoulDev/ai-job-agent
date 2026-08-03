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
