import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateSessionIdentifier, hashEmailIdentifier } from "@/lib/authRateLimit/identifiers";
import { AUTH_RATE_LIMIT_POLICIES, reserveAuthAttempt } from "@/lib/authRateLimit/rateLimit";
import { isValidEmailFormat, normalizeEmail } from "@/lib/authValidation/email";

const GENERIC_RATE_LIMIT_ERROR = "Too many requests. Please wait and try again.";
// Deliberately identical regardless of whether the email exists or the
// request was even attempted against Supabase — resetPasswordForEmail
// itself already always returns success for this exact reason. Never
// change this to reveal whether the rate limit or the account-existence
// check is what "succeeded".
const GENERIC_SUCCESS_MESSAGE =
  "If an account exists for this email, we've sent a secure password reset link.";

interface ForgotPasswordBody {
  email: string;
}

function parseBody(raw: unknown): ForgotPasswordBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  const email = b.email;

  if (typeof email !== "string") return null;
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmailFormat(normalizedEmail)) return null;

  return { email: normalizedEmail };
}

// POST /api/auth/forgot-password
// Defense-in-depth application-level rate limiting for password-reset
// requests — previously enforced only by a 60-second client-side cooldown
// (login/page.tsx's sibling issue: AGENTS.md §27 "do not rely only on
// client-side cooldowns"). Two independent gates, both must pass, same
// rationale as signup:
//   - email:   3 / 15 min — a legitimate user rarely needs more than 2-3
//     reset emails in that window.
//   - session: 5 / 15 min — an opaque, HttpOnly per-browser cookie, not the
//     submitted email. Without this, a script could mail-bomb many
//     different real users' inboxes by rotating the target email on every
//     request, since the email gate alone resets for every new address.
// Both RPCs are service_role-only, reachable only from this route. Always
// returns the identical generic success response for an allowed request
// regardless of whether the email belongs to a real account — matches
// resetPasswordForEmail's own enumeration-safe behavior exactly.
export async function POST(request: Request) {
  let body: ForgotPasswordBody | null;
  try {
    body = parseBody(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const emailHash = hashEmailIdentifier(body.email);
  const sessionHash = await getOrCreateSessionIdentifier();

  const emailGate = await reserveAuthAttempt(
    "forgot_password",
    "email",
    emailHash,
    AUTH_RATE_LIMIT_POLICIES.forgot_password_email
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
    "forgot_password",
    "session",
    sessionHash,
    AUTH_RATE_LIMIT_POLICIES.forgot_password_session
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

  // Derived from the actual incoming request, not a client-suppliable
  // body field — and Supabase's own GOTRUE_URI_ALLOW_LIST (configured
  // separately, see supabase/config.toml) is the authoritative check on
  // top of this, exactly as it already is for the OAuth redirectTo values
  // constructed client-side elsewhere in this app.
  const origin = new URL(request.url).origin;
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(body.email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  // Never surface error.message (raw Supabase Auth text) or let a
  // Supabase-side failure produce a response distinguishable from success
  // — resetPasswordForEmail already never reveals account existence, and
  // this route must not either. Any error here (including Supabase's own
  // built-in limiter, if active) is logged server-side and shown to the
  // user as the same generic success message: a real, allowed request that
  // Supabase silently declined to fulfil is not something the client
  // should be able to distinguish from "email sent".
  if (error) {
    console.error("resetPasswordForEmail error:", error.status, error.message);
  }

  return NextResponse.json({ ok: true, message: GENERIC_SUCCESS_MESSAGE });
}
