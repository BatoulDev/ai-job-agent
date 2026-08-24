-- Extends the defense-in-depth auth rate limiting added by
-- 20260822110000_add_login_rate_limiting.sql to cover signup,
-- forgot-password, and Google OAuth initiation, and fixes a real
-- vulnerability found while designing that coverage.
--
-- ── Vulnerability found and fixed ─────────────────────────────────────────
-- reserve_login_attempt()/clear_login_attempts() were granted EXECUTE to
-- anon and authenticated so the pre-auth login route (running as the
-- request's own anon-scoped session) could call them directly. That also
-- means ANY anonymous caller could call
-- supabase.rpc('reserve_login_attempt', { p_identifier_hash: sha256(lower(
-- 'victim@example.com')) }) directly and repeatedly — completely bypassing
-- src/app/api/auth/login/route.ts's own request shape and the real
-- signInWithPassword call — to pre-exhaust one specific victim's login
-- quota, a cheap, anonymous, targeted denial-of-service against that one
-- person's ability to log in through this app. Fixed by revoking
-- anon/authenticated entirely and granting EXECUTE to service_role only;
-- every caller now goes through src/lib/supabase/admin.ts's
-- createAdminClient() from server-only route-handler code (the same
-- established pattern already used by create_analysis_task /
-- charge_feedback_task_quota / the onboarding-complete route), which holds
-- the service-role key that is never sent to the browser. A browser can no
-- longer reach these functions at all, only our own trusted server can.
--
-- ── Generalization ─────────────────────────────────────────────────────────
-- reserve_login_attempt(text) / clear_login_attempts(text) are replaced by
-- reserve_auth_attempt(p_action, p_identifier_kind, p_identifier_hash,
-- p_limit, p_window_minutes) / clear_auth_attempts(p_action,
-- p_identifier_kind, p_identifier_hash) — one shared, parameterized
-- enforcement primitive reused by all four surfaces (login, signup,
-- forgot_password, oauth_init) rather than four near-identical functions.
-- Each surface's own route handler (src/lib/authRateLimit/rateLimit.ts)
-- supplies its own tuned limit/window; the atomicity, validation, and
-- storage are defined exactly once.
--
-- identifier_kind is either:
--   'email'   — sha256(lower(trim(email))), the natural key for login and
--               the primary key for signup/forgot_password.
--   'session' — sha256 of a random, opaque, HttpOnly cookie value
--               (src/lib/authRateLimit/identifiers.ts). Never derived from
--               IP or any client-settable header (no trusted proxy/IP
--               source exists in this app — see the prior migration's own
--               note). This is what stops "just submit a different email"
--               from bypassing the signup limit: the cookie-keyed bucket
--               follows the browser, not the submitted address. Applied to
--               signup and forgot_password (both classic email-rotation /
--               mail-bombing targets) and is the ONLY identifier available
--               for oauth_init, which has no email at all at initiation
--               time.
--
-- Neither identifier kind ever stores a raw email, password, OAuth token,
-- reset link, or the raw session cookie value itself — only a one-way
-- sha256 hash of each, exactly like the existing rate_limit_events /
-- auth_rate_limit_events convention.

-- ── 1. auth_rate_limit_events: add action + identifier_kind ─────────────────
alter table public.auth_rate_limit_events
  add column action          text,
  add column identifier_kind text;

update public.auth_rate_limit_events
set action = 'login', identifier_kind = 'email'
where action is null;

alter table public.auth_rate_limit_events
  alter column action set not null,
  alter column identifier_kind set not null,
  add constraint auth_rate_limit_events_action_check
    check (action in ('login', 'signup', 'forgot_password', 'oauth_init')),
  add constraint auth_rate_limit_events_identifier_kind_check
    check (identifier_kind in ('email', 'session'));

comment on table public.auth_rate_limit_events is
  'Append-only log of reserved auth attempts (login/signup/forgot_password/oauth_init), keyed by sha256 of either the submitted email or an opaque per-browser session cookie value — never the raw email, password, OAuth token, reset link, or raw cookie. Read/written only by reserve_auth_attempt()/clear_auth_attempts() (SECURITY DEFINER, service_role-only) and service_role directly. Never exposed to anon/authenticated — no policy, no grant.';

drop index if exists public.auth_rate_limit_events_identifier_created_idx;
create index auth_rate_limit_events_lookup_idx
  on public.auth_rate_limit_events (action, identifier_kind, identifier_hash, created_at desc);

-- ── 2. Replace the 1-arg functions with the generalized, service_role-only pair ──
drop function if exists public.reserve_login_attempt(text);
drop function if exists public.clear_login_attempts(text);

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
  if p_action not in ('login', 'signup', 'forgot_password', 'oauth_init') then
    raise exception 'Invalid action.';
  end if;
  if p_identifier_kind not in ('email', 'session') then
    raise exception 'Invalid identifier kind.';
  end if;
  if p_identifier_hash is null or p_identifier_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid identifier.';
  end if;
  -- Bounds are defensive, not policy — the real limit/window values live in
  -- src/lib/authRateLimit/rateLimit.ts, one named constant per surface.
  -- These just stop a caller-side bug (e.g. a stray 0) from silently
  -- becoming "block everyone forever" or "no limit at all".
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Invalid limit.';
  end if;
  if p_window_minutes is null or p_window_minutes < 1 or p_window_minutes > 1440 then
    raise exception 'Invalid window.';
  end if;

  v_window := (p_window_minutes || ' minutes')::interval;

  -- Serializes reservations for this one (action, identifier_kind,
  -- identifier_hash) so the count-then-insert sequence below is atomic
  -- under concurrency — released automatically at transaction end. Never
  -- blocks a different identifier's or a different action's calls.
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

comment on function public.reserve_auth_attempt(text, text, text, integer, integer) is
  'Atomically checks and reserves one auth-attempt slot for (action, identifier_kind, identifier_hash). service_role only — called exclusively from server-only Next.js route handlers via createAdminClient() (src/lib/authRateLimit/rateLimit.ts), never reachable from the browser, so a caller cannot target an arbitrary victim identifier by calling this RPC directly.';

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
  if p_action not in ('login', 'signup', 'forgot_password', 'oauth_init') then
    raise exception 'Invalid action.';
  end if;
  if p_identifier_kind not in ('email', 'session') then
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

comment on function public.clear_auth_attempts(text, text, text) is
  'Resets the rolling-window count for (action, identifier_kind, identifier_hash) after a genuinely successful attempt. service_role only, same trust boundary as reserve_auth_attempt().';
