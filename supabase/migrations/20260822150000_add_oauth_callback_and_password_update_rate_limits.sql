-- Closes two of the remaining gaps found during the rate-limiting review
-- (2026-08-22): src/app/auth/callback/route.ts (Google OAuth code exchange
-- AND password-reset-link verification) and the password-update-after-
-- recovery call in src/app/reset-password/page.tsx had zero rate limiting
-- of any kind. Extends the existing generalized auth-rate-limit
-- infrastructure (20260822130000_generalize_auth_rate_limits.sql) with two
-- new actions rather than inventing a parallel mechanism.
--
-- oauth_callback is session-keyed (the same arl_sid cookie already used for
-- signup/forgot-password/oauth-init) with a generous 20/15min limit — a
-- real user hits this endpoint once per login/reset-link click, so this
-- only bounds a script hammering the endpoint with garbage `code` values
-- from one browser session; it must never block a legitimate one-click
-- provider redirect.
--
-- password_update introduces a new identifier_kind, 'user': at this point
-- in the flow the caller already has a valid, authenticated recovery
-- session (established by exchangeCodeForSession in the callback above),
-- so the authenticated user's own id is the correct, precise identifier —
-- there is no reason to fall back to email or session-cookie keying once
-- we know exactly who is asking. 8/15min is generous enough that a page
-- refresh (which never calls updateUser on its own — only an actual form
-- submit does) can never lock a legitimate user out of setting their
-- password.
alter table public.auth_rate_limit_events
  drop constraint auth_rate_limit_events_action_check,
  add constraint auth_rate_limit_events_action_check
    check (action in ('login', 'signup', 'forgot_password', 'oauth_init', 'oauth_callback', 'password_update')),
  drop constraint auth_rate_limit_events_identifier_kind_check,
  add constraint auth_rate_limit_events_identifier_kind_check
    check (identifier_kind in ('email', 'session', 'user'));

-- Same body as 20260822130000_generalize_auth_rate_limits.sql's
-- reserve_auth_attempt, with both allowlists extended to match the new
-- check constraints above. Everything else — advisory locking, atomic
-- count-then-insert, retry_after_seconds computation, service_role-only
-- grant — is unchanged.
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
  if p_action not in ('login', 'signup', 'forgot_password', 'oauth_init', 'oauth_callback', 'password_update') then
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
  if p_action not in ('login', 'signup', 'forgot_password', 'oauth_init', 'oauth_callback', 'password_update') then
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
