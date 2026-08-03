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
