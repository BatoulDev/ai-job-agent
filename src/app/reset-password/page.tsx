"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthLayout from "@/components/auth/AuthLayout";
import AuthCard from "@/components/auth/AuthCard";
import PasswordField from "@/components/auth/PasswordField";
import { createClient } from "@/lib/supabase/client";
import { useRetryCountdown } from "@/lib/authRateLimit/useRetryCountdown";
import { MIN_PASSWORD_LENGTH, PASSWORD_HINT, getPasswordValidationError } from "@/lib/authValidation/password";

type PageState = "loading" | "no_session" | "form";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { retryCountdown, startRetryCountdown } = useRetryCountdown();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setPageState(user ? "form" : "no_session");
    });
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || retryCountdown > 0) return;
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");

    const passwordError = getPasswordValidationError(password);
    if (passwordError) {
      setErrorMessage(passwordError);
      document.getElementById("password")?.focus();
      return;
    }
    if (password !== confirm) {
      setErrorMessage("Passwords do not match.");
      document.getElementById("confirm")?.focus();
      return;
    }

    setIsSubmitting(true);

    // Routed through our own server (src/app/api/auth/update-password/
    // route.ts) rather than calling supabase.auth.updateUser() directly,
    // so repeated attempts against this authenticated recovery session are
    // rate-limited server-side, consistent with every other auth surface.
    let response: Response;
    try {
      response = await fetch("/api/auth/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
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
          : "Failed to update your password. Please try again.";
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

    // Sign out after a successful password change to prevent session fixation
    // and force the user to log in with the new password.
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login?message=password_changed");
  };

  if (pageState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <p className="text-sm text-muted">Loading...</p>
      </div>
    );
  }

  if (pageState === "no_session") {
    return (
      <AuthLayout>
        <AuthCard
          title="Link expired or invalid"
          footer={
            <p className="text-center text-sm text-muted">
              Already have a new password?{" "}
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
            <p className="text-sm leading-relaxed text-muted">
              This password reset link has expired, already been used, or is
              invalid. Reset links are valid for one use only.
            </p>
            <Link
              href="/forgot-password"
              className="block w-full rounded-full bg-primary px-6 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark"
            >
              Request a new reset link
            </Link>
          </div>
        </AuthCard>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthCard
        title="Set a new password"
        description="Choose a strong password for your account."
        footer={
          <p className="text-center text-sm text-muted">
            Changed your mind?{" "}
            <Link
              href="/login"
              className="font-semibold text-primary hover:text-primary-dark"
            >
              Back to login
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

          <PasswordField
            id="password"
            label="New password"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            autoComplete="new-password"
            helperText={PASSWORD_HINT}
          />

          <PasswordField
            id="confirm"
            label="Confirm new password"
            placeholder="Re-enter your new password"
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
            disabled={isSubmitting || retryCountdown > 0}
            className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Updating password..." : "Set new password"}
          </button>
        </form>
      </AuthCard>
    </AuthLayout>
  );
}
