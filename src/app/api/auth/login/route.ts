import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashEmailIdentifier } from "@/lib/authRateLimit/identifiers";
import { AUTH_RATE_LIMIT_POLICIES, clearAuthAttempts, reserveAuthAttempt } from "@/lib/authRateLimit/rateLimit";
import { isValidEmailFormat, normalizeEmail } from "@/lib/authValidation/email";
import { resolvePostAuthDestination } from "@/lib/entitlements/postAuthDestination";
import { MAX_PASSWORD_LENGTH } from "@/lib/authValidation/password";

const GENERIC_LOGIN_ERROR = "Incorrect email or password.";
const GENERIC_RATE_LIMIT_ERROR = "Too many login attempts. Please wait and try again.";
const INVALID_INPUT_ERROR = "Please enter a valid email and password.";

interface LoginBody {
  email: string;
  password: string;
}

// Login deliberately never re-validates password length/composition against
// the *current* policy (src/lib/authValidation/password.ts) — an existing
// account may have set its password under an older or different policy, and
// login must still accept it. Only the email is normalized/validated here.
function parseBody(raw: unknown): LoginBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  const email = b.email;
  const password = b.password;

  if (typeof email !== "string") return null;
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmailFormat(normalizedEmail)) return null;
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    return null;
  }

  return { email: normalizedEmail, password };
}

// POST /api/auth/login
// Defense-in-depth application-level login rate limiting (see
// supabase/migrations/20260822110000_add_login_rate_limiting.sql for why
// this exists: the Supabase built-in sign_in_sign_ups limiter does not
// currently activate against the local GoTrue instance). Keyed only by a
// hash of the submitted email — never an IP address — so a shared network
// never blocks unrelated users, and the response never reveals whether the
// email belongs to a real account. The reservation RPC is service_role-only
// (supabase/migrations/20260822130000_generalize_auth_rate_limits.sql), so
// this route — never the browser — is the only thing that can consume or
// clear a slot.
export async function POST(request: Request) {
  let body: LoginBody | null;
  try {
    body = parseBody(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body) {
    return NextResponse.json({ error: INVALID_INPUT_ERROR }, { status: 400 });
  }

  const identifierHash = hashEmailIdentifier(body.email);

  const gate = await reserveAuthAttempt("login", "email", identifierHash, AUTH_RATE_LIMIT_POLICIES.login);

  if (gate === null) {
    return NextResponse.json(
      { error: "We couldn't process your request right now. Please try again shortly." },
      { status: 500 }
    );
  }

  if (!gate.allowed) {
    return NextResponse.json(
      { error: GENERIC_RATE_LIMIT_ERROR, retryAfterSeconds: gate.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } }
    );
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });

  if (signInError) {
    // Supabase Auth's own built-in limiter, when active, surfaces here as a
    // 429 — propagate it as our own safe 429 rather than a generic 401.
    if (signInError.status === 429) {
      return NextResponse.json({ error: GENERIC_RATE_LIMIT_ERROR }, { status: 429 });
    }
    // Every other failure (wrong password, unknown email, unconfirmed
    // email, disabled account, ...) gets the exact same enumeration-safe
    // message — never signInError.message (raw Supabase Auth text), and
    // never a message that would let a caller distinguish these cases.
    return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }

  // Successful login: reset this identifier's failure history. Non-fatal
  // if it errors — the session cookie is already set by signInWithPassword
  // above, so a stale failure count would only make the next 15-minute
  // window slightly stricter, never block this already-successful session.
  await clearAuthAttempts("login", "email", identifierHash);

  // Resolve the landing page via the same authoritative, DB-backed
  // resolver the OAuth callback uses (src/lib/entitlements/
  // postAuthDestination.ts) — never a hardcoded "/dashboard". This is what
  // makes email/password login and Google OAuth share one routing
  // decision: a returning user with no active CV yet lands on
  // /onboarding/upload-cv here exactly as they would via the callback, and
  // a fully onboarded user lands on /dashboard either way. Failure here is
  // deliberately non-fatal — the session is already established, so a
  // readiness lookup hiccup falls back to /dashboard (which has its own
  // safe loading/error states) rather than failing an otherwise-successful
  // login.
  let destination = "/dashboard";
  try {
    const resolved = await resolvePostAuthDestination();
    if (resolved.kind === "redirect") {
      destination = resolved.path;
    }
  } catch {
    // Keep the /dashboard fallback.
  }

  return NextResponse.json({ ok: true, destination });
}
