-- Defense-in-depth login rate limiting (see docs/PRODUCTION_READINESS.md,
-- "Auth endpoints (login/signup/OAuth/reset)").
--
-- ── Root cause this addresses ─────────────────────────────────────────────
-- supabase/config.toml's [auth.rate_limit] sets sign_in_sign_ups = 30 (per
-- 5 min per IP), intended to bound the password-grant endpoint. Verified
-- directly against the running local GoTrue container
-- (`docker exec supabase_auth_<project> env`): every OTHER key in that
-- config section (email_sent, anonymous_users, token_refresh, sms_sent,
-- web3) is correctly translated into a GOTRUE_RATE_LIMIT_* environment
-- variable by the installed Supabase CLI (2.109.1) — but sign_in_sign_ups
-- is not translated into any GoTrue env var at all, so the local GoTrue
-- instance enforces no limit on /auth/v1/token?grant_type=password.
-- Reproduced empirically: 100 invalid-password requests plus 15 valid ones,
-- fired back-to-back, all returned normal 200/400 responses with no 429 and
-- no rate-limit response header. This is a local CLI/tooling gap, not
-- something this migration can fix directly (there is no application code
-- path that controls GoTrue's own env vars) — production may or may not
-- have the same gap depending on how the hosted project's dashboard value
-- is actually applied (already tracked as "unverified" in the readiness
-- doc). This migration adds the application-level layer AGENTS.md §27
-- already requires regardless ("Do not rely only on client-side cooldowns
-- or disabled buttons") as a second, independent line of defense that does
-- not depend on GoTrue's own limiter working.
--
-- ── Design ─────────────────────────────────────────────────────────────────
-- Keyed ONLY by a hash of the account identifier (email) — never by IP.
-- There is no trusted proxy/IP-extraction layer in this app (no
-- @vercel/functions, no verified forwarding-header source), so an
-- IP-keyed limit would either be trivially bypassed (spoof
-- X-Forwarded-For) or would incorrectly lock out every legitimate user
-- behind one shared IP/NAT (office wifi, campus network) the moment one of
-- them is attacked — both explicitly disallowed by this change's brief.
-- Identifier-only keying also makes the response inherently
-- enumeration-safe: the block decision never depends on whether the email
-- corresponds to a real account, and a different account's identifier is
-- always on its own independent counter.
--
-- The email itself is never stored — only sha256(lower(trim(email))),
-- computed application-side (src/app/api/auth/login/route.ts, Node's
-- built-in crypto, no new dependency) and passed in as p_identifier_hash.
-- Storing a keyed hash rather than the raw address avoids holding a second
-- copy of user PII in a dedicated security-log table for no functional
-- benefit.
--
-- reserve_login_attempt() is a single atomic check-and-insert (under
-- pg_advisory_xact_lock, exactly like replace_cv's quota) rather than a
-- separate check then a separate insert, so a burst of concurrent/
-- double-click requests for the same identifier cannot all pass the count
-- check before any of them are recorded — each attempt (successful or
-- not) is reserved eagerly; a genuinely successful login then clears the
-- window via clear_login_attempts(). 5 attempts per rolling 15 minutes per
-- identifier.
--
-- Callable by anon (login happens pre-session) and authenticated (harmless
-- if ever called from an authenticated context). Fully opaque otherwise —
-- same doubly-enforced default-deny as rate_limit_events: RLS enabled with
-- zero policies for authenticated, no table-level grant to
-- anon/authenticated at all, only reachable through these two SECURITY
-- DEFINER functions (or service_role for test fixtures/inspection).

create table public.auth_rate_limit_events (
  id              uuid        primary key default gen_random_uuid(),
  identifier_hash text        not null,
  created_at      timestamptz not null default now()
);

comment on table public.auth_rate_limit_events is
  'Append-only log of reserved login attempts, keyed by sha256(lower(trim(email))) — never the raw email or an IP address. Read/written only by reserve_login_attempt() / clear_login_attempts() (SECURITY DEFINER) and service_role. Never exposed to authenticated — no policy, no grant.';

create index auth_rate_limit_events_identifier_created_idx
  on public.auth_rate_limit_events (identifier_hash, created_at desc);

alter table public.auth_rate_limit_events enable row level security;

revoke all on public.auth_rate_limit_events from public, authenticated, anon;
grant select, insert, update, delete on public.auth_rate_limit_events to service_role;

create or replace function public.reserve_login_attempt(p_identifier_hash text)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent_count integer;
  v_oldest       timestamptz;
begin
  -- Defensive validation: a well-formed lowercase-hex sha256 digest is
  -- always exactly 64 characters. Rejects malformed direct-RPC calls
  -- (bypassing the Next.js route) without ever touching the table.
  if p_identifier_hash is null or p_identifier_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid identifier.';
  end if;

  -- Serializes reservations for this one identifier so the count-then-
  -- insert sequence below is atomic under concurrency (rapid double-click,
  -- or a deliberate concurrent burst) — released automatically at
  -- transaction end. Never blocks a different identifier's calls.
  perform pg_advisory_xact_lock(hashtext('login_attempt:' || p_identifier_hash)::bigint);

  select count(*), min(created_at) into v_recent_count, v_oldest
  from public.auth_rate_limit_events
  where identifier_hash = p_identifier_hash
    and created_at > now() - interval '15 minutes';

  if v_recent_count >= 5 then
    return query select
      false,
      greatest(1, ceil(extract(epoch from ((v_oldest + interval '15 minutes') - now())))::integer);
    return;
  end if;

  insert into public.auth_rate_limit_events (identifier_hash) values (p_identifier_hash);

  return query select true, 0;
end;
$$;

revoke execute on function public.reserve_login_attempt(text) from public;
grant execute on function public.reserve_login_attempt(text) to anon, authenticated;

comment on function public.reserve_login_attempt(text) is
  'Atomically checks and reserves one login attempt slot for sha256(lower(trim(email))). At most 5 reservations per rolling 15 minutes per identifier. Returns allowed=false with retry_after_seconds when exhausted; never inserts on a blocked call. Called before every password-grant attempt from src/app/api/auth/login/route.ts.';

create or replace function public.clear_login_attempts(p_identifier_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_identifier_hash is null or p_identifier_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid identifier.';
  end if;

  delete from public.auth_rate_limit_events where identifier_hash = p_identifier_hash;
end;
$$;

revoke execute on function public.clear_login_attempts(text) from public;
grant execute on function public.clear_login_attempts(text) to anon, authenticated;

comment on function public.clear_login_attempts(text) is
  'Resets the rolling-window failure count for sha256(lower(trim(email))) after a genuinely successful login. Called from src/app/api/auth/login/route.ts only after supabase.auth.signInWithPassword() succeeds.';
