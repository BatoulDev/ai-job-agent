"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AuthLayout from "@/components/auth/AuthLayout";
import AuthCard from "@/components/auth/AuthCard";
import FormField from "@/components/auth/FormField";
import { createClient } from "@/lib/supabase/client";
import { isSafeRedirectPath } from "@/lib/safeRedirect";

const UPLOAD_CV_PATH = "/onboarding/upload-cv";
const NEWS_PATH = "/news";
const MIN_PASSWORD_LENGTH = 8;

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
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleGoogleSignUp = async () => {
    if (isGoogleLoading || isSubmitting) return;
    setErrorMessage(null);
    setIsGoogleLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setErrorMessage("Failed to start Google sign-in. Please try again.");
      setIsGoogleLoading(false);
    }
    // On success, signInWithOAuth redirects the browser — no further action.
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

    const formData = new FormData(event.currentTarget);
    const fullName = String(formData.get("fullName") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!fullName || !email || !password) {
      setErrorMessage("Please fill in your name, email, and password.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorMessage(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      );
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    if (error) {
      setErrorMessage(error.message);
      setIsSubmitting(false);
      return;
    }

    // Supabase returns a 200 with an empty identities array (not an error)
    // when the email is already registered, to avoid leaking which emails
    // exist. Treat that the same as a duplicate-signup error.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setErrorMessage(
        "An account with this email already exists. Try logging in instead."
      );
      setIsSubmitting(false);
      return;
    }

    if (!data.session) {
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
              {errorMessage}
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
            disabled={isGoogleLoading || isSubmitting}
            className="flex w-full items-center justify-center gap-3 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-text shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <GoogleIcon />
            {isGoogleLoading ? "Redirecting..." : "Continue with Google"}
          </button>

          <div className="relative flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-medium text-muted">or</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
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
            <FormField
              id="password"
              label="Password"
              type="password"
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />

            <button
              type="submit"
              disabled={isSubmitting || isGoogleLoading}
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
