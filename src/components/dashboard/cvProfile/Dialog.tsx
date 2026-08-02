"use client";

import { useEffect, useRef } from "react";

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

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, onClose]);

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
