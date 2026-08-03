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

function SignupPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

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
        <form onSubmit={handleSubmit} className="space-y-5">
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
            disabled={isSubmitting}
            className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Creating your account..." : "Create my account"}
          </button>

          <p className="text-center text-xs leading-relaxed text-muted">
            Your CV and application data stay private. Nothing is sent
            without your approval.
          </p>
        </form>
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
