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
import { MIN_PASSWORD_LENGTH } from "@/lib/authValidation/password";

const UPLOAD_CV_PATH = "/onboarding/upload-cv";
const NEWS_PATH = "/news";
// Kept in sync with SIGNUP_CONFLICT_CODE in src/app/api/auth/signup/route.ts —
// the one signal this page uses to decide whether to show the "Sign in" /
// "Reset password" actions alongside the (deliberately neutral) message,
// rather than matching on the message text itself.
const SIGNUP_CONFLICT_CODE = "signup_conflict";

function getSignupDestination(next: string | null): string {
  // Reject anything that isn't a safe same-origin relative path up front
  // (including a bare "//evil.com", which the old `!next` check alone let
  // through unchecked below) before ever considering returning it verbatim.
  if (!isSafeRedirectPath(next)) return `${UPLOAD_CV_PATH}?gift=1`;

  const [path, query = ""] = next.split("?");

  // "/news" is a special case, not just another protected route: unauthenticated
  // visitors get sent there by news/page.tsx's own gate as "/signup?next=/news",
  // and honoring that next verbatim would skip the gift popup entirely and send
  // a brand-new user straight to /news. Route through the same popup flow as a
  // plain signup instead — the popup's own Claim button is the one path to /news.
  if (path === NEWS_PATH) return `${UPLOAD_CV_PATH}?gift=1`;

  if (path !== UPLOAD_CV_PATH) return next;

  const params = new URLSearchParams(query);
  params.set("gift", "1");
  return `${path}?${params.toString()}`;
}

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

function SignupPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSignupConflict, setIsSignupConflict] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const { retryCountdown, startRetryCountdown, resetRetryCountdown } = useRetryCountdown();
  const googleCountdown = useRetryCountdown();

  // Same rationale as login/page.tsx's identical handler: this countdown is
  // a client-side courtesy only, never the real gate — see
  // src/app/api/auth/signup/route.ts. Resetting it on input change just
  // lets a different email typed into the same form get a fresh, correct
  // server decision instead of looking permanently stuck.
  const handleFieldsChange = () => {
    // Also clears a signup-conflict message on edit — correcting the email
    // and retrying is the explicit recovery path this page offers for that
    // case, so the stale message/actions shouldn't linger once the user
    // has started changing what they submitted.
    if (isSignupConflict) {
      setErrorMessage(null);
      setIsSignupConflict(false);
    }
    if (retryCountdown === 0) return;
    resetRetryCountdown();
    setErrorMessage(null);
  };

  const handleGoogleSignUp = async () => {
    if (isGoogleLoading || isSubmitting || googleCountdown.retryCountdown > 0) return;
    setErrorMessage(null);
    setIsSignupConflict(false);
    setIsGoogleLoading(true);

    const result = await startGoogleOAuth();

    if (!result.ok) {
      setErrorMessage(result.error ?? "Failed to start Google sign-in. Please try again.");
      setIsGoogleLoading(false);
      if (result.retryAfterSeconds) {
        googleCountdown.startRetryCountdown(result.retryAfterSeconds);
      }
    }
    // On success, signInWithOAuth already redirected the browser.
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || retryCountdown > 0) return;
    setErrorMessage(null);
    setIsSignupConflict(false);
    setInfoMessage(null);

    const formData = new FormData(event.currentTarget);
    const fullName = String(formData.get("fullName") ?? "").trim();
    const email = normalizeEmail(String(formData.get("email") ?? ""));
    const password = String(formData.get("password") ?? "");

    if (!fullName || !email || !password) {
      setErrorMessage("Please fill in your name, email, and password.");
      return;
    }
    if (!isValidEmailFormat(email)) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorMessage(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      );
      return;
    }

    setIsSubmitting(true);

    // Routed through our own server (src/app/api/auth/signup/route.ts)
    // rather than calling supabase.auth.signUp() directly, so repeated
    // attempts — including ones that simply change the submitted email —
    // are rate-limited server-side. See that route for the two-gate design.
    let response: Response;
    try {
      response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, fullName }),
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
      const code =
        typeof data === "object" && data !== null && "code" in data && typeof (data as { code: unknown }).code === "string"
          ? (data as { code: string }).code
          : null;
      setErrorMessage(message);
      setIsSignupConflict(code === SIGNUP_CONFLICT_CODE);
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

    const needsEmailConfirmation =
      typeof data === "object" &&
      data !== null &&
      "needsEmailConfirmation" in data &&
      (data as { needsEmailConfirmation: unknown }).needsEmailConfirmation === true;

    if (needsEmailConfirmation) {
      setInfoMessage(
        "Account created. Check your email to confirm your account before logging in."
      );
      setIsSubmitting(false);
      return;
    }

    router.push(getSignupDestination(searchParams.get("next")));
  };

  return (
    <AuthLayout>
      <AuthCard
        title="Create your account"
        description="Create your account to start uploading your CV and matching with the right roles."
        footer={
          <p className="text-center text-sm text-muted">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold text-primary hover:text-primary-dark"
            >
              Log in
            </Link>
          </p>
        }
      >
        <div className="space-y-5">
          {errorMessage && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              <p>{errorMessage}</p>
              {isSignupConflict && (
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
                  <Link href="/login" className="text-primary hover:text-primary-dark">
                    Sign in
                  </Link>
                  <Link href="/forgot-password" className="text-primary hover:text-primary-dark">
                    Reset password
                  </Link>
                </p>
              )}
            </div>
          )}
          {infoMessage && (
            <div
              role="status"
              className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-text"
            >
              {infoMessage}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleSignUp}
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

          <form onSubmit={handleSubmit} onChange={handleFieldsChange} className="space-y-5">
            <FormField
              id="fullName"
              label="Full name"
              placeholder="Jane Doe"
              autoComplete="name"
            />
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
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              autoComplete="new-password"
            />

            {retryCountdown > 0 && (
              <p role="status" aria-live="polite" className="text-center text-sm text-muted">
                You can try again in{" "}
                <span className="font-medium text-text">{retryCountdown}s</span>
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting || isGoogleLoading || retryCountdown > 0}
              className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Creating your account..." : "Create my account"}
            </button>

            <p className="text-center text-xs leading-relaxed text-muted">
              Your CV and application data stay private. Nothing is sent
              without your approval.
            </p>
          </form>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageContent />
    </Suspense>
  );
}
