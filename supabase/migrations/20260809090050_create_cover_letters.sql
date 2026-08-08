-- cover_letters: one row per match. Foundation only — no generation worker
-- is built here. generated_content is the AI draft; edited_content is the
-- user's latest edit; approved_content is a frozen snapshot taken only at
-- approval time, so a later edit can never retroactively change what was
-- already approved (the exact requirement: "content used later for
-- sending must be the explicitly approved version").
create table public.cover_letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id uuid not null references public.matches (id) on delete cascade,

  generated_content text,
  edited_content text,
  revision integer not null default 1 check (revision > 0),
  generation_status text not null default 'pending' check (generation_status in ('pending', 'completed', 'failed')),

  approval_status text not null default 'draft' check (approval_status in ('draft', 'user_approved')),
  approved_content text,
  approved_at timestamptz,

  model_provider text,
  model_version text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A row can only be "approved" once it actually has content to freeze.
  constraint cover_letters_approved_requires_content check (
    approval_status <> 'user_approved' or approved_content is not null
  )
);

comment on table public.cover_letters is
  'One row per match. approved_content is a frozen snapshot taken only by approve_cover_letter() — later edits to edited_content never retroactively change what was approved.';

-- One cover letter per match (revision is an in-row counter, not a
-- separate history table — proportional for an MVP with no generator yet).
create unique index cover_letters_match_id_key on public.cover_letters (match_id);

alter table public.cover_letters enable row level security;

create trigger set_cover_letters_updated_at
  before update on public.cover_letters
  for each row
  execute function public.set_updated_at();

create policy "cover_letters_select_own"
  on public.cover_letters
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete for authenticated: generation is a future
-- worker's job (service_role); edits/approval go through
-- save_cover_letter_edit/approve_cover_letter (20260809090100).
grant select on public.cover_letters to authenticated;
grant select, insert, update, delete on public.cover_letters to service_role;
