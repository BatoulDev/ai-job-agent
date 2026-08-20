"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setProfileUpdatePending } from "@/lib/optimisticProfileUpdate";

const MAX_NAME_LENGTH = 200;
const CANCEL_HREF = "/dashboard?tab=cv-profile";

interface Props {
  initialName: string;
}

export default function UpdateNameForm({ initialName }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSaving) return;

    const raw = inputRef.current?.value ?? "";
    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      setFieldError("Please enter your full name.");
      inputRef.current?.focus();
      return;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setFieldError(`Name must be ${MAX_NAME_LENGTH} characters or fewer.`);
      inputRef.current?.focus();
      return;
    }

    setFieldError(null);
    setServerError(null);
    setIsSaving(true);

    try {
      const res = await fetch("/api/profile/update-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setServerError(body.error ?? "Could not update your name. Please try again.");
        setIsSaving(false);
        return;
      }

      // Signal the dashboard to show the processing popup immediately
      // before the new analysis task row is visible to polling queries.
      setProfileUpdatePending("user_request");
      router.push(CANCEL_HREF);
    } catch {
      setServerError("Could not reach the server. Please check your connection.");
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div>
        <label
          htmlFor="full-name"
          className="mb-1.5 block text-sm font-medium text-text"
        >
          Full name
        </label>
        <input
          ref={inputRef}
          id="full-name"
          name="full_name"
          type="text"
          defaultValue={initialName}
          autoComplete="name"
          autoFocus
          maxLength={MAX_NAME_LENGTH}
          disabled={isSaving}
          aria-describedby={fieldError ? "name-error" : undefined}
          className={[
            "w-full rounded-xl border px-4 py-2.5 text-sm text-text placeholder:text-muted/60",
            "bg-bg outline-none transition-colors",
            "focus:border-primary focus:ring-2 focus:ring-primary/20",
            "disabled:cursor-not-allowed disabled:opacity-60",
            fieldError ? "border-red-400" : "border-slate-200",
          ].join(" ")}
          placeholder="Your full name"
        />
        {fieldError && (
          <p id="name-error" className="mt-1.5 text-xs text-red-600">
            {fieldError}
          </p>
        )}
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          This name is compared to the name on your CV to verify ownership.
        </p>
      </div>

      {serverError && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {serverError}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving…" : "Save name"}
        </button>

        <Link
          href={CANCEL_HREF}
          className="inline-flex items-center justify-center rounded-full border border-slate-200 px-6 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-slate-300 hover:text-text"
          aria-disabled={isSaving}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
