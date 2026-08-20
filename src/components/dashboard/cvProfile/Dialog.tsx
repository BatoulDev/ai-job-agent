"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

// Shared accessible dialog shell for the CV Profile page's two dialogs
// (ApproveProfileDialog, RequestChangesDialog). Same visual pattern as
// src/components/onboarding/GiftModal.tsx (backdrop + centered rounded
// card), extended with keyboard support GiftModal doesn't have: Escape to
// close, and focus moved into the dialog on open / returned to the
// trigger element on close.
export default function Dialog({
  open,
  onClose,
  titleId,
  children,
  maxWidthClassName = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  titleId: string;
  children: React.ReactNode;
  maxWidthClassName?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // Hold a stable ref to onClose so the effect below does not re-run when
  // the parent passes a new inline function on every render. Without this,
  // every keystroke in a controlled input triggers a parent re-render that
  // creates a fresh onClose reference, which fires the effect, which calls
  // panelRef.focus() and steals focus from the input the user was typing in.
  const onCloseRef = useRef(onClose);
  // useLayoutEffect (no deps) runs after every render, before paint, keeping
  // the ref in sync without triggering the Escape-handler effect.
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open]); // onClose intentionally excluded — handled via onCloseRef above

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 px-4 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={`relative max-h-[90vh] w-full overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl outline-none sm:p-8 ${maxWidthClassName}`}
      >
        {children}
      </div>
    </div>
  );
}
