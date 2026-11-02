"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { startGoogleOAuth } from "@/lib/authRateLimit/startGoogleOAuth";

const CONFIRM_PHRASE = "DELETE";
const SELF_PATH = "/settings/delete-account";

type Step = "reauth" | "confirm" | "deleting" | "done";

interface Props {
  provider: "password" | "google";
  initiallyFresh: boolean;
}

function parseErrorBody(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const message = (data as Record<string, unknown>).error;
  return typeof message === "string" ? message : null;
}

export default function DeleteAccountForm({ provider, initiallyFresh }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initiallyFresh ? "confirm" : "reauth");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmTextRef = useRef<HTMLInputElement>(null);
  const acknowledgeRef = useRef<HTMLInputElement>(null);

  async function handlePasswordReauth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting) return;

    const password = passwordRef.current?.value ?? "";
    if (password.length === 0) {
      setErrorMessage("Please enter your password.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/account/reauthenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErrorMessage(parseErrorBody(body) ?? "Could not verify your password. Please try again.");
        setIsSubmitting(false);
        return;
      }
      setStep("confirm");
      setIsSubmitting(false);
    } catch {
      setErrorMessage("Could not reach the server. Please check your connection.");
      setIsSubmitting(false);
    }
  }

  async function handleGoogleReauth() {
    if (isSubmitting) return;
    setErrorMessage(null);
    setIsSubmitting(true);
    const result = await startGoogleOAuth({
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(SELF_PATH)}`,
      forceConsent: true,
    });
    if (!result.ok) {
      setErrorMessage(result.error ?? "Failed to start Google re-authentication. Please try again.");
      setIsSubmitting(false);
    }
    // On success, the browser is already navigating to Google — nothing
    // else to do here.
  }

  async function handleFinalDelete(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting) return;

    if (!acknowledgeRef.current?.checked) {
      setErrorMessage("Please confirm you understand this cannot be undone.");
      return;
    }
    if ((confirmTextRef.current?.value ?? "").trim() !== CONFIRM_PHRASE) {
      setErrorMessage(`Please type ${CONFIRM_PHRASE} to confirm.`);
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    setStep("deleting");
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: CONFIRM_PHRASE }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (res.status === 403 && parseErrorBody(body) === "REAUTH_REQUIRED") {
          setErrorMessage("Your re-authentication expired. Please re-authenticate again.");
          setStep("reauth");
          setIsSubmitting(false);
          return;
        }
        setErrorMessage(parseErrorBody(body) ?? "Could not delete your account. Please try again.");
        setStep("confirm");
        setIsSubmitting(false);
        return;
      }

      setStep("done");
      const supabase = createClient();
      await supabase.auth.signOut();
      window.setTimeout(() => {
        router.push("/");
      }, 2000);
    } catch {
      setErrorMessage("Could not reach the server. Please check your connection.");
      setStep("confirm");
      setIsSubmitting(false);
    }
  }

  if (step === "done") {
    return (
      <p className="text-sm font-medium text-text" role="status">
        Your account has been deleted. Redirecting you now…
      </p>
    );
  }

  if (step === "reauth") {
    return (
      <div>
        <p className="text-sm leading-relaxed text-muted">
          For your security, please re-authenticate before deleting your account.
        </p>

        {provider === "password" ? (
          <form onSubmit={handlePasswordReauth} noValidate className="mt-6">
            <label htmlFor="reauth-password" className="mb-1.5 block text-sm font-medium text-text">
              Current password
            </label>
            <input
              ref={passwordRef}
              id="reauth-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              disabled={isSubmitting}
              className="w-full rounded-xl border border-slate-200 bg-bg px-4 py-2.5 text-sm text-text outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
            />
            {errorMessage && (
              <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {errorMessage}
              </p>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-6 inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Verifying…" : "Confirm password"}
            </button>
          </form>
        ) : (
          <div className="mt-6">
            {errorMessage && (
              <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {errorMessage}
              </p>
            )}
            <button
              type="button"
              onClick={handleGoogleReauth}
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Redirecting to Google…" : "Re-authenticate with Google"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // step === "confirm" or "deleting"
  return (
    <form onSubmit={handleFinalDelete} noValidate>
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        This will permanently delete your account and all associated data. This action cannot be
        undone.
      </div>

      <label className="mt-6 flex items-start gap-2 text-sm text-text">
        <input
          ref={acknowledgeRef}
          type="checkbox"
          disabled={step === "deleting"}
          className="mt-0.5"
        />
        I understand this permanently deletes my account and cannot be undone.
      </label>

      <div className="mt-4">
        <label htmlFor="confirm-text" className="mb-1.5 block text-sm font-medium text-text">
          Type {CONFIRM_PHRASE} to confirm
        </label>
        <input
          ref={confirmTextRef}
          id="confirm-text"
          type="text"
          autoComplete="off"
          disabled={step === "deleting"}
          className="w-full rounded-xl border border-slate-200 bg-bg px-4 py-2.5 text-sm text-text outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      {errorMessage && (
        <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={step === "deleting"}
        className="mt-6 inline-flex items-center justify-center rounded-full bg-red-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {step === "deleting" ? "Deleting…" : "Permanently delete my account"}
      </button>
    </form>
  );
}
