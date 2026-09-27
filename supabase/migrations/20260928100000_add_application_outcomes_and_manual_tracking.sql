-- Phase 10 — Application Tracking, manual tracking first.
--
-- application_outcomes tracks the real-world result of a SENT application
-- (interviewing/rejected/offer/withdrawn), deliberately kept separate from
-- applications.status (which only tracks whether OUR system successfully
-- transmitted it). Mixing these into one column would conflate "did we send
-- it" with "what happened afterward" — two different questions with two
-- different owners (system vs. the outside world).
--
-- One row per application (current outcome, not a history log) — simpler
-- than an event-sourced table for what this build actually needs tonight;
-- audit_events already gets an entry per report for the historical trail.
-- `source` allows exactly one value today: 'user_manual'. Per explicit
-- product instruction ("any email/Gmail parsing must be optional and
-- confidence-aware... do not infer application outcomes from weak
-- evidence... keep uncertain events in manual-review/unknown state"), an
-- automated email-detected source is a deliberate future extension, not
-- built here — see docs/OVERNIGHT_CREDENTIALS_REQUIRED.md. Extending the
-- check constraint to add 'email_detected' (plus a confidence column) is
-- the documented upgrade path once that feature is explicitly approved and
-- a Gmail API credential exists.
create table public.application_outcomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  outcome_status text not null default 'unknown' check (outcome_status in ('unknown', 'interviewing', 'rejected', 'offer', 'withdrawn')),
  source text not null default 'user_manual' check (source in ('user_manual')),
  notes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.application_outcomes is
  'One row per application: its current real-world outcome, self-reported by the user. Never auto-inferred tonight — see report_application_outcome().';

create unique index application_outcomes_application_id_key on public.application_outcomes (application_id);

alter table public.application_outcomes enable row level security;

create trigger set_application_outcomes_updated_at
  before update on public.application_outcomes
  for each row
  execute function public.set_updated_at();

create policy "application_outcomes_select_own"
  on public.application_outcomes
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete for authenticated: writes only via
-- report_application_outcome() below, never a raw client write (same
-- pattern as matches/cover_letters/applications).
grant select on public.application_outcomes to authenticated;
grant select, insert, update, delete on public.application_outcomes to service_role;

-- New audit event type for this phase's manual outcome reports.
alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'cv_analysis_confirmed', 'cover_letter_approved', 'match_approved', 'match_rejected',
  'application_approved', 'application_send_attempted', 'application_send_result',
  'application_outcome_reported',
  'admin_job_created', 'admin_job_updated', 'admin_job_deleted', 'account_data_deleted',
  'price_version_published'
));

-- Manual tracking action #1: the user confirms they actually applied via an
-- external_link application (nothing in this system sends it for them — see
-- Phase 09's findPendingApplications.ts). Idempotent if already 'sent'.
-- Deliberately restricted to external_link: an 'email' application's status
-- is already system-tracked by the real send attempt, never user-editable.
create or replace function public.mark_application_sent(p_application_id uuid)
returns public.applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.applications;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_row from public.applications where id = p_application_id and user_id = v_user_id for update;
  if not found then
    raise exception 'Application not found.';
  end if;

  if v_row.application_method <> 'external_link' then
    raise exception 'Only external-link applications can be manually marked as sent.';
  end if;

  if v_row.status = 'sent' then
    return v_row; -- idempotent no-op
  end if;

  if v_row.status <> 'pending_send' then
    raise exception 'This application is not waiting to be marked as sent.';
  end if;

  update public.applications
  set status = 'sent'
  where id = p_application_id
  returning * into v_row;

  insert into public.audit_events (user_id, actor_type, event_type, entity_type, entity_id, metadata)
  values (v_user_id, 'user', 'application_send_result', 'application', p_application_id, jsonb_build_object('outcome', 'sent', 'reported_by', 'user_manual'));

  return v_row;
end;
$$;

revoke execute on function public.mark_application_sent(uuid) from public;
grant execute on function public.mark_application_sent(uuid) to authenticated;

-- Manual tracking action #2: the user reports what actually happened after
-- a sent application. Requires the application to actually be 'sent' first
-- — reporting an outcome for something never sent would be a fabricated
-- fact, not a real report (AGENTS.md §8: "do not invent... application
-- status"). Upserts the single current-outcome row; the audit trail below
-- is the historical record of when each report was made.
create or replace function public.report_application_outcome(p_application_id uuid, p_outcome_status text, p_notes text default null)
returns public.application_outcomes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_application public.applications;
  v_row public.application_outcomes;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_outcome_status not in ('unknown', 'interviewing', 'rejected', 'offer', 'withdrawn') then
    raise exception 'Invalid outcome status.';
  end if;

  select * into v_application from public.applications where id = p_application_id and user_id = v_user_id;
  if not found then
    raise exception 'Application not found.';
  end if;

  if v_application.status <> 'sent' then
    raise exception 'You can only report an outcome for an application that has actually been sent.';
  end if;

  insert into public.application_outcomes (user_id, application_id, outcome_status, source, notes)
  values (v_user_id, p_application_id, p_outcome_status, 'user_manual', p_notes)
  on conflict (application_id) do update
    set outcome_status = excluded.outcome_status, notes = excluded.notes, source = 'user_manual'
  returning * into v_row;

  insert into public.audit_events (user_id, actor_type, event_type, entity_type, entity_id, metadata)
  values (v_user_id, 'user', 'application_outcome_reported', 'application', p_application_id, jsonb_build_object('outcome_status', p_outcome_status));

  return v_row;
end;
$$;

revoke execute on function public.report_application_outcome(uuid, text, text) from public;
grant execute on function public.report_application_outcome(uuid, text, text) to authenticated;
