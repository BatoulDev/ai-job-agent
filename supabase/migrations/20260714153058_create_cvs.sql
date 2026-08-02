-- cvs: one active CV per user (MVP — matches the current single-file
-- upload UI, not a version history). See the CV replacement design notes
-- in DATABASE_PLAN.md / the Phase 1 report for how a replacement upload
-- avoids ever leaving this row pointing at a missing storage object.
--
-- Ownership boundary: user_id references auth.users.id. storage_path is
-- never trusted from the client — it is computed server-side and is
-- constrained below to always live under the owning user's own folder,
-- which also blocks path-traversal attempts at the database layer as a
-- second line of defense behind the Storage policies.
create table public.cvs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  file_size_bytes integer not null check (file_size_bytes > 0 and file_size_bytes <= 5242880),
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  status text not null default 'uploaded' check (status in ('uploaded', 'parsed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cvs_storage_path_owned_by_user check (
    storage_path like (user_id::text || '/%')
    and storage_path not like '%..%'
  )
);

comment on table public.cvs is
  'One active CV row per auth.users id (MVP). Ownership is user_id -> auth.users.id, never file_name or email.';

alter table public.cvs enable row level security;

create trigger set_cvs_updated_at
  before update on public.cvs
  for each row
  execute function public.set_updated_at();

create policy "cvs_select_own"
  on public.cvs
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "cvs_insert_own"
  on public.cvs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "cvs_update_own"
  on public.cvs
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "cvs_delete_own"
  on public.cvs
  for delete
  to authenticated
  using (auth.uid() = user_id);
