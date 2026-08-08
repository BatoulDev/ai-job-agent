-- audit_events: append-only record of security/business-significant
-- events (CV-analysis confirmation, cover-letter/match/application
-- approval, send attempts, admin job changes, account deletion). No update
-- or delete policy exists for anyone but service_role — ordinary users can
-- read their own events but can never create, alter, or delete one,
-- closing off forged trusted history.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  -- set null (not cascade): an audit trail should outlive the account it
  -- describes, e.g. "account_data_deleted" needs to remain readable by an
  -- admin after the user_id it refers to no longer resolves to a live row.
  user_id uuid references auth.users (id) on delete set null,
  actor_type text not null check (actor_type in ('user', 'admin', 'system')),
  event_type text not null check (event_type in (
    'cv_analysis_confirmed', 'cover_letter_approved', 'match_approved', 'match_rejected',
    'application_approved', 'application_send_attempted', 'application_send_result',
    'admin_job_created', 'admin_job_updated', 'admin_job_deleted', 'account_data_deleted'
  )),
  entity_type text,
  entity_id uuid,
  -- Safe operational metadata only — never CV contents, cover-letter
  -- bodies, secrets, or tokens (AGENTS.md §19).
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

comment on table public.audit_events is
  'Append-only. No authenticated insert/update/delete policy exists at all — every row is written by a trusted SECURITY DEFINER RPC (confirm_cv_analysis, approve_match, etc.) or service_role, never a raw client write.';

create index audit_events_user_created_idx on public.audit_events (user_id, created_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);

alter table public.audit_events enable row level security;

-- A user reads events about themselves; an admin reads everything.
create policy "audit_events_select_own"
  on public.audit_events
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "audit_events_select_admin"
  on public.audit_events
  for select
  to authenticated
  using (public.is_admin());

-- No insert/update/delete policy for authenticated at all — see the table
-- comment. service_role and the SECURITY DEFINER RPCs in this schema are
-- the only write paths.
grant select on public.audit_events to authenticated;
grant select, insert on public.audit_events to service_role;
