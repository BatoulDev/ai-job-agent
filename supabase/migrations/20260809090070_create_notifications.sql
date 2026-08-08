-- notifications: delivery log for user-facing events. Foundation only — no
-- delivery worker is built here; nothing is sent by this migration.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  notification_type text not null check (notification_type in (
    'cv_analysis_ready', 'match_ready', 'cover_letter_ready', 'application_sent', 'application_failed'
  )),
  related_entity_type text check (related_entity_type in ('cv_analysis', 'match', 'cover_letter', 'application')),
  related_entity_id uuid,
  channel text not null default 'in_app' check (channel in ('in_app', 'email')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'read')),
  -- Nullable + unique (not not-null + unique): a worker that wants
  -- send-time dedup can supply one; not every notification needs one.
  idempotency_key text unique,

  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  updated_at timestamptz not null default now()
);

create index notifications_user_status_idx on public.notifications (user_id, status, created_at desc);

alter table public.notifications enable row level security;

create trigger set_notifications_updated_at
  before update on public.notifications
  for each row
  execute function public.set_updated_at();

create policy "notifications_select_own"
  on public.notifications
  for select
  to authenticated
  using (auth.uid() = user_id);

grant select on public.notifications to authenticated;
grant select, insert, update, delete on public.notifications to service_role;

-- The one user-facing mutation notifications need: marking their own
-- notification read. SECURITY DEFINER only for symmetry/consistency with
-- every other cross-boundary write in this schema and because
-- notifications otherwise has zero authenticated write grant at all.
create or replace function public.mark_notification_read(p_notification_id uuid)
returns public.notifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.notifications;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.notifications
  set status = 'read', read_at = coalesce(read_at, now())
  where id = p_notification_id and user_id = v_user_id
  returning * into v_row;

  if not found then
    raise exception 'Notification not found.';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.mark_notification_read(uuid) from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;
