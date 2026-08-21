"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AuthLayout from "@/components/auth/AuthLayout";
import AuthCard from "@/components/auth/AuthCard";
import FormField from "@/components/auth/FormField";
import { createClient } from "@/lib/supabase/client";

const RESEND_COOLDOWN_SECONDS = 60;

function ResetSuccessModal({ onClose }: { onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-modal-title"
      aria-describedby="reset-modal-desc"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={dialogRef}
        className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-2xl"
      >
        {/* Close button */}
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-5 top-5 rounded-full p-1.5 text-muted transition-colors hover:bg-slate-100 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Envelope icon */}
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#1E3A8A"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        </div>

        <h2
          id="reset-modal-title"
          className="font-display text-xl font-semibold tracking-tight text-text"
        >
          Check your inbox
        </h2>

        <p
          id="reset-modal-desc"
          className="mt-3 text-sm leading-relaxed text-muted"
        >
          If an account exists for this email, we&apos;ve sent a secure password
          reset link. Please check your inbox and spam folder.
        </p>

        <p className="mt-3 text-xs leading-relaxed text-muted/80">
          For your security, the link will expire. You may need to wait before
          requesting another email.
        </p>

        <Link
          href="/login"
          className="mt-6 block w-full rounded-full bg-primary px-6 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Back to login
        </Link>
      </div>
    </div>
  );
}

function ForgotPasswordPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  const startCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setCountdown(RESEND_COOLDOWN_SECONDS);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const handleModalClose = useCallback(() => {
    setShowModal(false);
    setTimeout(() => submitButtonRef.current?.focus(), 0);
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || countdown > 0) return;
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    if (!email) {
      setErrorMessage("Please enter your email address.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    setIsSubmitting(false);

    if (error) {
      // Supabase returns an error for hard rate limits (e.g. 429).
      // Show a safe, non-revealing message — never disclose account existence.
      setErrorMessage(
        "Please wait a little longer before requesting another email."
      );
      return;
    }

    // The Supabase API always returns success for resetPasswordForEmail
    // regardless of whether an account exists, to prevent enumeration.
    // Show the modal and start the resend cooldown.
    setShowModal(true);
    startCountdown();
  };

  const isDisabled = isSubmitting || countdown > 0;

  return (
    <>
      {showModal && <ResetSuccessModal onClose={handleModalClose} />}
      <AuthLayout>
        <AuthCard
          title="Reset your password"
          description="Enter your account email and we'll send you a reset link."
          footer={
            <p className="text-center text-sm text-muted">
              Remember your password?{" "}
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

            <FormField
              id="email"
              label="Email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
            />

            {countdown > 0 && (
              <p
                role="status"
                aria-live="polite"
                className="text-center text-sm text-muted"
              >
                You can request another email in{" "}
                <span className="font-medium text-text">{countdown}s</span>
              </p>
            )}

            <button
              ref={submitButtonRef}
              type="submit"
              disabled={isDisabled}
              className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {isSubmitting ? "Sending..." : "Send reset link"}
            </button>
          </form>
        </AuthCard>
      </AuthLayout>
    </>
  );
}

export default ForgotPasswordPage;
