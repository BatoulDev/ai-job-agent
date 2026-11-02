-- Adds 'account_reauth' as an allowed action for the existing generalized
-- auth-rate-limit infrastructure (20260822130000_generalize_auth_rate_limits.sql,
-- extended by 20260822150000_add_oauth_callback_and_password_update_rate_limits.sql).
--
-- Needed for POST /api/account/reauthenticate (src/lib/authRateLimit/
-- rateLimit.ts's new "account_reauth" action): the password re-entry gate
-- in front of account deletion (AGENTS.md §28 "sensitive account changes
-- should require recent authentication"; founder-approved 2026-11-02 —
-- see docs/ACCOUNT_DELETION_DESIGN.md). Reuses the existing 'user'
-- identifier_kind — same reasoning as 'password_update': the caller is
-- already authenticated at this point, so their own id is the correct,
-- precise identifier, never email or the anonymous session cookie.
--
-- Same body as the prior migration, allowlist extended by exactly one
-- value. Everything else (advisory locking, atomic count-then-insert,
-- retry_after_seconds computation, service_role-only grant) is unchanged.
alter table public.auth_rate_limit_events
  drop constraint auth_rate_limit_events_action_check,
  add constraint auth_rate_limit_events_action_check
    check (action in ('login', 'signup', 'forgot_password', 'oauth_init', 'oauth_callback', 'password_update', 'account_reauth'));

create or replace function public.reserve_auth_attempt(
  p_action          text,
  p_identifier_kind text,
  p_identifier_hash text,
  p_limit           integer,
  p_window_minutes  integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent_count integer;
  v_oldest       timestamptz;
  v_window       interval;
begin
  if p_action not in ('login', 'signup', 'forgot_password', 'oauth_init', 'oauth_callback', 'password_update', 'account_reauth') then
    raise exception 'Invalid action.';
  end if;
  if p_identifier_kind not in ('email', 'session', 'user') then
    raise exception 'Invalid identifier kind.';
  end if;
  if p_identifier_hash is null or p_identifier_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid identifier.';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Invalid limit.';
  end if;
  if p_window_minutes is null or p_window_minutes < 1 or p_window_minutes > 1440 then
    raise exception 'Invalid window.';
  end if;

  v_window := (p_window_minutes || ' minutes')::interval;

  perform pg_advisory_xact_lock(
    hashtext(p_action || ':' || p_identifier_kind || ':' || p_identifier_hash)::bigint
  );

  select count(*), min(created_at) into v_recent_count, v_oldest
  from public.auth_rate_limit_events
  where action = p_action
    and identifier_kind = p_identifier_kind
    and identifier_hash = p_identifier_hash
    and created_at > now() - v_window;

  if v_recent_count >= p_limit then
    return query select
      false,
      greatest(1, ceil(extract(epoch from ((v_oldest + v_window) - now())))::integer);
    return;
  end if;

  insert into public.auth_rate_limit_events (action, identifier_kind, identifier_hash)
  values (p_action, p_identifier_kind, p_identifier_hash);

  return query select true, 0;
end;
$$;

revoke execute on function public.reserve_auth_attempt(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_auth_attempt(text, text, text, integer, integer) to service_role;

create or replace function public.clear_auth_attempts(
  p_action          text,
  p_identifier_kind text,
  p_identifier_hash text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action not in ('login', 'signup', 'forgot_password', 'oauth_init', 'oauth_callback', 'password_update', 'account_reauth') then
    raise exception 'Invalid action.';
  end if;
  if p_identifier_kind not in ('email', 'session', 'user') then
    raise exception 'Invalid identifier kind.';
  end if;
  if p_identifier_hash is null or p_identifier_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid identifier.';
  end if;

  delete from public.auth_rate_limit_events
  where action = p_action
    and identifier_kind = p_identifier_kind
    and identifier_hash = p_identifier_hash;
end;
$$;

revoke execute on function public.clear_auth_attempts(text, text, text) from public, anon, authenticated;
grant execute on function public.clear_auth_attempts(text, text, text) to service_role;
