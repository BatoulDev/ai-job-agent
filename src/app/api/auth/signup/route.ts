import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateSessionIdentifier, hashEmailIdentifier } from "@/lib/authRateLimit/identifiers";
import { AUTH_RATE_LIMIT_POLICIES, clearAuthAttempts, reserveAuthAttempt } from "@/lib/authRateLimit/rateLimit";
import { isValidEmailFormat, normalizeEmail } from "@/lib/authValidation/email";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "@/lib/authValidation/password";

const MAX_NAME_LENGTH = 200;
const GENERIC_RATE_LIMIT_ERROR = "Too many signup attempts. Please wait and try again.";
const GENERIC_SIGNUP_ERROR = "We couldn't create your account right now. Please try again.";
// Deliberately conditional wording ("if you already have an account"),
// never an affirmative "this email already exists" — shown for every
// signup-conflict outcome (both the "empty identities" 200 Supabase itself
// returns for an unconfirmed existing user, and the real `user_already_
// exists`/`email_exists` AuthApiError GoTrue returns for an already-
// confirmed one, which is the normal case in this local/dev environment
// since email confirmation is auto-enabled). Both map to the exact same
// message, status, and machine-readable `code` below, so a scripted caller
// gets one indistinguishable response regardless of which internal path
// Supabase took — see docs/PRODUCTION_READINESS.md for the residual,
// unavoidable-without-an-email-only-notification-flow limitation this
// still carries (a genuinely new signup succeeds or asks for email
// confirmation; only an existing email ever sees this exact message).
const SIGNUP_CONFLICT_ERROR =
  "We couldn't create the account. If you already have an account, try signing in or resetting your password.";
const SIGNUP_CONFLICT_CODE = "signup_conflict";

// Known, stable GoTrue error codes for "this email is already registered"
// (see node_modules/@supabase/auth-js/.../error-codes.d.ts). Confirmed
// empirically against local GoTrue: signUp() against an already-confirmed
// existing user returns { status: 422, code: "user_already_exists" }, not
// the empty-identities 200 — that path is only taken for an unconfirmed
// existing user. Both codes are handled the same way below.
const DUPLICATE_EMAIL_ERROR_CODES = new Set(["user_already_exists", "email_exists"]);

interface SignupBody {
  email: string;
  password: string;
  fullName: string;
}

function parseBody(raw: unknown): SignupBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  const email = b.email;
  const password = b.password;
  const fullName = b.fullName;

  if (typeof email !== "string") return null;
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmailFormat(normalizedEmail)) return null;
  if (
    typeof password !== "string" ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    return null;
  }
  if (typeof fullName !== "string" || fullName.trim().length === 0 || fullName.length > MAX_NAME_LENGTH) {
    return null;
  }

  return { email: normalizedEmail, password, fullName: fullName.trim() };
}

// POST /api/auth/signup
// Defense-in-depth application-level signup rate limiting — the Supabase
// built-in sign_in_sign_ups limiter (shared with login) is confirmed
// non-functional against the local GoTrue instance (see
// supabase/migrations/20260822110000_add_login_rate_limiting.sql).
//
// Two independent gates, both must pass:
//   - email:   5 / 15 min — bounds repeated attempts against one address.
//   - session: 8 / 15 min — an opaque, HttpOnly per-browser cookie
//     (src/lib/authRateLimit/identifiers.ts), NOT the submitted email, so
//     simply changing the email on each attempt cannot bypass this. This is
//     the only thing standing between "one script, unlimited fake
//     addresses" and this endpoint, since the email gate alone resets for
//     every new address.
// Both RPCs are service_role-only, reachable only from this route.
export async function POST(request: Request) {
  let body: SignupBody | null;
  try {
    body = parseBody(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body) {
    return NextResponse.json(
      {
        error: `Please provide your name, a valid email, and a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
      },
      { status: 400 }
    );
  }

  const emailHash = hashEmailIdentifier(body.email);
  const sessionHash = await getOrCreateSessionIdentifier();

  const emailGate = await reserveAuthAttempt(
    "signup",
    "email",
    emailHash,
    AUTH_RATE_LIMIT_POLICIES.signup_email
  );
  if (emailGate === null) {
    return NextResponse.json(
      { error: "We couldn't process your request right now. Please try again shortly." },
      { status: 500 }
    );
  }
  if (!emailGate.allowed) {
    return NextResponse.json(
      { error: GENERIC_RATE_LIMIT_ERROR, retryAfterSeconds: emailGate.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(emailGate.retryAfterSeconds) } }
    );
  }

  const sessionGate = await reserveAuthAttempt(
    "signup",
    "session",
    sessionHash,
    AUTH_RATE_LIMIT_POLICIES.signup_session
  );
  if (sessionGate === null) {
    return NextResponse.json(
      { error: "We couldn't process your request right now. Please try again shortly." },
      { status: 500 }
    );
  }
  if (!sessionGate.allowed) {
    return NextResponse.json(
      { error: GENERIC_RATE_LIMIT_ERROR, retryAfterSeconds: sessionGate.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(sessionGate.retryAfterSeconds) } }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: body.email,
    password: body.password,
    options: { data: { full_name: body.fullName } },
  });

  if (error) {
    // Never surface error.message (raw Supabase Auth text) or error.code
    // to the client in any branch below — only the three hand-authored
    // messages in this file are ever returned.
    if (error.status === 429) {
      return NextResponse.json({ error: GENERIC_RATE_LIMIT_ERROR }, { status: 429 });
    }
    if (error.code && DUPLICATE_EMAIL_ERROR_CODES.has(error.code)) {
      return NextResponse.json(
        { error: SIGNUP_CONFLICT_ERROR, code: SIGNUP_CONFLICT_CODE },
        { status: 409 }
      );
    }
    // A genuinely unexpected failure (network/server/GoTrue-internal) —
    // log only a safe operational identifier (status + stable code, never
    // .message, never the submitted email/password) so this stays
    // diagnosable without risking sensitive data in server logs.
    console.error("signUp unexpected error:", error.status, error.code);
    return NextResponse.json({ error: GENERIC_SIGNUP_ERROR }, { status: 500 });
  }

  // Supabase returns a 200 with an empty identities array (not an error)
  // when the email belongs to an existing, unconfirmed user — Supabase's
  // own anti-enumeration technique for that specific case. Mapped to the
  // exact same response as the AuthApiError path above so both duplicate
  // cases are indistinguishable from one another (and from each other's
  // underlying cause) to the caller.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return NextResponse.json(
      { error: SIGNUP_CONFLICT_ERROR, code: SIGNUP_CONFLICT_CODE },
      { status: 409 }
    );
  }

  // A genuinely accepted signup — successful or pending email confirmation
  // — resets the email-keyed gate only (that specific address is now
  // registered; nothing to keep bounding). The session-keyed gate is
  // deliberately NEVER cleared, on success or otherwise: it exists
  // specifically to bound how many signup attempts one browser can make
  // in the window regardless of outcome. Clearing it on every success
  // would let a script create unlimited accounts one after another, each
  // success resetting the very counter meant to stop that — defeating the
  // one thing this gate exists for (see the "changing the submitted email
  // cannot bypass the session-keyed signup gate" test in
  // tests/db/auth-rate-limit.test.mjs).
  await clearAuthAttempts("signup", "email", emailHash);

  return NextResponse.json({ ok: true, needsEmailConfirmation: !data.session });
}
