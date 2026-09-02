"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import Link from "next/link";

const GIFT_BULLETS = [
  "10 quick AI/tech updates",
  "Simple summaries, no noise",
  "Updated regularly by automation",
  "Free with your account",
];

// Accessible dialog behavior (focus trap, initial focus, Escape-to-close,
// return focus to whatever had focus before opening) mirrors
// src/components/dashboard/cvProfile/Dialog.tsx's proven pattern, inlined
// here rather than reused directly: that shared shell applies uniform
// padding around its children, which would clip GiftModal's full-bleed
// gradient header — this component's own visual layout is otherwise kept
// pixel-identical to before.
export default function GiftModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // Stable ref to onClose so the effect below only re-runs when `open`
  // changes, never on every parent re-render.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gift-modal-title"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-accent px-8 pb-8 pt-8 text-white">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_85%_0%,rgba(255,255,255,0.28),transparent)]" />

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close free gift offer and continue to Upload CV"
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>

          <span className="relative inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                d="m12 2 2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2Z"
                strokeLinejoin="round"
              />
            </svg>
            Free gift unlocked
          </span>

          <h2
            id="gift-modal-title"
            className="relative mt-4 font-display text-2xl font-semibold tracking-tight"
          >
            You unlocked free AI & Tech News 🎁
          </h2>
          <p className="relative mt-2 text-sm leading-relaxed text-white/85">
            Get a simple daily AI and tech brief curated for students and
            young builders — free with your AI Job Agent account.
          </p>
        </div>

        <div className="px-8 py-7">
          <ul className="space-y-3">
            {GIFT_BULLETS.map((bullet) => (
              <li
                key={bullet}
                className="flex items-start gap-3 text-sm text-text"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <path
                      d="m5 13 4 4L19 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                {bullet}
              </li>
            ))}
          </ul>

          <div className="mt-7 flex flex-col gap-3">
            <Link
              href="/news"
              className="w-full rounded-full bg-gradient-to-r from-primary to-accent px-6 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Claim free gift
            </Link>
            <button
              type="button"
              onClick={onClose}
              aria-label="Not now, continue to Upload CV"
              className="w-full rounded-full border border-slate-200 px-6 py-3 text-sm font-semibold text-muted transition-colors hover:border-slate-300 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Not now
            </button>
          </div>

          <p className="mt-5 text-center text-xs leading-relaxed text-muted">
            You can access AI/Tech News anytime from the navbar.
          </p>
        </div>
      </div>
    </div>
  );
}
