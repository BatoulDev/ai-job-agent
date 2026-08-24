"use client";

import { useState } from "react";

const fieldClass =
  "w-full rounded-xl border border-slate-200 bg-bg px-4 py-2.5 pr-11 text-sm text-text placeholder:text-muted/60 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
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
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
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
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// Shared password input with a show/hide toggle, used by login, signup, and
// reset-password. The toggle is a real type="button" (never submits the
// form), keyboard-operable like any button, never steals focus from the
// input, and its aria-label updates with the current state — see AGENTS.md
// "Provide show/hide controls using type=button, keyboard support,
// focus-safe behavior, and dynamic aria-label". Show/hide state is local
// and self-contained; it never reads or logs the password value itself.
export default function PasswordField({
  id,
  label,
  placeholder,
  autoComplete,
  required = true,
  helperText,
}: {
  id: string;
  label: string;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  helperText?: string;
}) {
  const [show, setShow] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-text">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={show ? "text" : "password"}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          className={fieldClass}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted transition-colors hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <EyeIcon open={show} />
        </button>
      </div>
      {helperText && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted">{helperText}</p>
      )}
    </div>
  );
}
