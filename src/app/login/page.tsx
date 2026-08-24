"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AuthLayout from "@/components/auth/AuthLayout";
import AuthCard from "@/components/auth/AuthCard";
import FormField from "@/components/auth/FormField";
import PasswordField from "@/components/auth/PasswordField";
import { isSafeRedirectPath } from "@/lib/safeRedirect";
import { useRetryCountdown } from "@/lib/authRateLimit/useRetryCountdown";
import { startGoogleOAuth } from "@/lib/authRateLimit/startGoogleOAuth";
import { isValidEmailFormat, normalizeEmail } from "@/lib/authValidation/email";

const ERROR_MESSAGES: Record<string, string> = {
  google_auth_failed:
    "Google sign-in was cancelled or failed. Please try again.",
  link_expired:
    "Your sign-in link has expired or already been used. Please request a new one.",
  auth_error:
    "Authentication failed. If the issue persists, please contact support.",
  too_many_attempts:
    "Too many attempts. Please wait a bit and try again.",
};

function GoogleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");
  const messageParam = searchParams.get("message");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    errorParam ? (ERROR_MESSAGES[errorParam] ?? "An unexpected error occurred. Please try again.") : null
  );
  const { retryCountdown, startRetryCountdown, resetRetryCountdown } = useRetryCountdown();
  const googleCountdown = useRetryCountdown();

  // The countdown/disabled-button state above is a client-side courtesy
  // tied to whichever email last got rate-limited — it is never the real
  // gate (that's reserve_auth_attempt(), scoped per-identifier server-
  // side). Without this, editing either field after a block leaves the
  // form looking stuck for a *different* account typed into the same
  // form (e.g. a shared device), even though that account's own request
  // would succeed. Resetting it here is safe: a resubmit for the account
  // that's actually still blocked is simply re-rejected by the server
  // with a freshly recalculated retry_after_seconds.
  const handleCredentialsChange = () => {
    if (retryCountdown === 0) return;
    resetRetryCountdown();
    setErrorMessage(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || retryCountdown > 0) return;
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const email = normalizeEmail(String(formData.get("email") ?? ""));
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      setErrorMessage("Please enter your email and password.");
      return;
    }
    if (!isValidEmailFormat(email)) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    setIsSubmitting(true);

    // Routed through our own server (src/app/api/auth/login/route.ts)
    // rather than calling supabase.auth.signInWithPassword() directly, so
    // repeated attempts are rate-limited server-side (defense-in-depth —
    // see that route for why) instead of relying only on this disabled
    // button, which a script could ignore entirely.
    let response: Response;
    try {
      response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      setErrorMessage("Could not reach the server. Please try again.");
      setIsSubmitting(false);
      return;
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message =
        typeof data === "object" && data !== null && "error" in data && typeof (data as { error: unknown }).error === "string"
          ? (data as { error: string }).error
          : "Something went wrong. Please try again.";
      setErrorMessage(message);
      setIsSubmitting(false);
      if (response.status === 429) {
        const retryAfterSeconds =
          typeof data === "object" && data !== null && "retryAfterSeconds" in data && typeof (data as { retryAfterSeconds: unknown }).retryAfterSeconds === "number"
            ? (data as { retryAfterSeconds: number }).retryAfterSeconds
            : Number(response.headers.get("Retry-After")) || 60;
        startRetryCountdown(retryAfterSeconds);
      }
      return;
    }

    // Precedence: an explicit, safe `next` (e.g. a deep link into a
    // protected route) always wins over the readiness-derived destination —
    // same precedence documented in src/app/auth/callback/route.ts. Absent
    // that, use the server-computed `destination` from the authoritative
    // resolver (src/lib/entitlements/postAuthDestination.ts) rather than a
    // hardcoded "/dashboard", so a returning user with no active CV yet is
    // routed to onboarding here exactly as they would be via Google OAuth.
    const next = searchParams.get("next");
    const destination =
      typeof data === "object" && data !== null && "destination" in data && typeof (data as { destination: unknown }).destination === "string"
        ? (data as { destination: string }).destination
        : "/dashboard";
    router.push(isSafeRedirectPath(next) ? next : destination);
  };

  const handleGoogleSignIn = async () => {
    if (isGoogleLoading || isSubmitting || googleCountdown.retryCountdown > 0) return;
    setErrorMessage(null);
    setIsGoogleLoading(true);

    // Gated server-side (src/app/api/auth/oauth-init/route.ts) before the
    // actual redirect to Google — see that route for why this exists and
    // its documented limitation.
    const result = await startGoogleOAuth();

    if (!result.ok) {
      setErrorMessage(result.error ?? "Failed to start Google sign-in. Please try again.");
      setIsGoogleLoading(false);
      if (result.retryAfterSeconds) {
        googleCountdown.startRetryCountdown(result.retryAfterSeconds);
      }
    }
    // On success, signInWithOAuth already redirected the browser — no
    // further action needed; isGoogleLoading intentionally stays true
    // until navigation away from this page.
  };

  return (
    <AuthLayout>
      <AuthCard
        title="Log in to AI Job Agent"
        description="Pick up your matches, cover letters, and applications right where you left off."
        footer={
          <p className="text-center text-sm text-muted">
            New to AI Job Agent?{" "}
            <Link
              href="/signup"
              className="font-semibold text-primary hover:text-primary-dark"
            >
              Create an account
            </Link>
          </p>
        }
      >
        <div className="space-y-5">
          {messageParam === "password_changed" && (
            <div
              role="status"
              className="rounded-xl border border-success/30 bg-success/5 px-4 py-3 text-sm text-success"
            >
              Password updated successfully. Please log in with your new
              password.
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {errorMessage}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isGoogleLoading || isSubmitting || googleCountdown.retryCountdown > 0}
            className="flex w-full items-center justify-center gap-3 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-text shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <GoogleIcon />
            {isGoogleLoading ? "Redirecting..." : "Continue with Google"}
          </button>

          {googleCountdown.retryCountdown > 0 && (
            <p role="status" aria-live="polite" className="text-center text-sm text-muted">
              You can try Google sign-in again in{" "}
              <span className="font-medium text-text">{googleCountdown.retryCountdown}s</span>
            </p>
          )}

          <div className="relative flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-medium text-muted">or</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <form onSubmit={handleSubmit} onChange={handleCredentialsChange} className="space-y-5">
            <FormField
              id="email"
              label="Email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
            />
            <PasswordField
              id="password"
              label="Password"
              placeholder="Your password"
              autoComplete="current-password"
            />

            <div className="text-right">
              <Link
                href="/forgot-password"
                className="text-sm font-medium text-primary hover:text-primary-dark"
              >
                Forgot password?
              </Link>
            </div>

            {retryCountdown > 0 && (
              <p
                role="status"
                aria-live="polite"
                className="text-center text-sm text-muted"
              >
                You can try again in{" "}
                <span className="font-medium text-text">{retryCountdown}s</span>
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting || isGoogleLoading || retryCountdown > 0}
              className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Logging in..." : "Log in"}
            </button>
          </form>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
