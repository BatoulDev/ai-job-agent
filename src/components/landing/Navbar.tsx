"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import JoinBetaButton from "./JoinBetaButton";
import { createClient } from "@/lib/supabase/client";
import { useSupabaseUser } from "@/lib/supabase/useSupabaseUser";
import { SECTION_NAV_LINKS } from "@/lib/navLinks";

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const { user, isLoading } = useSupabaseUser();
  const isLoggedIn = !!user;
  // Render neither the signed-in nor signed-out CTA until the real session
  // check resolves, so the navbar never briefly shows the wrong state.
  const showLoggedInUI = !isLoading && isLoggedIn;
  const showLoggedOutUI = !isLoading && !isLoggedIn;
  const router = useRouter();
  const pathname = usePathname();

  const handleLogoClick = () => {
    setIsOpen(false);

    if (pathname === "/") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleLogout = async () => {
    setIsOpen(false);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/");
  };

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-bg/80 backdrop-blur-md">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-8">
        <Link href="/" onClick={handleLogoClick} className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent">
            <span className="h-2.5 w-2.5 rounded-full bg-white" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight text-text">
            AI Job Agent
          </span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {SECTION_NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted transition-colors hover:text-text"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/news"
            className="text-sm font-medium text-muted transition-colors hover:text-text"
          >
            AI/Tech News
          </Link>
        </div>

        <div className="hidden items-center gap-4 md:flex">
          {showLoggedInUI && (
            <>
              <Link
                href="/dashboard"
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-text transition-colors hover:border-slate-300"
              >
                Dashboard
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="text-sm font-medium text-muted transition-colors hover:text-text"
              >
                Log out
              </button>
            </>
          )}
          {showLoggedOutUI && (
            <JoinBetaButton className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark" />
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-text md:hidden"
          aria-label="Toggle menu"
          aria-expanded={isOpen}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {isOpen ? (
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </nav>

      {isOpen && (
        <div className="border-t border-slate-200/70 bg-bg px-6 py-4 md:hidden">
          <div className="flex flex-col gap-4">
            {SECTION_NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className="text-sm font-medium text-muted hover:text-text"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/news"
              onClick={() => setIsOpen(false)}
              className="text-sm font-medium text-muted hover:text-text"
            >
              AI/Tech News
            </Link>

            {showLoggedInUI && (
              <div className="mt-2 flex flex-col gap-3 border-t border-slate-200/70 pt-4">
                <Link
                  href="/dashboard"
                  onClick={() => setIsOpen(false)}
                  className="rounded-full border border-slate-200 px-5 py-2.5 text-center text-sm font-medium text-text"
                >
                  Dashboard
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="text-sm font-medium text-muted hover:text-text"
                >
                  Log out
                </button>
              </div>
            )}
            {showLoggedOutUI && (
              <JoinBetaButton
                className="mt-2 rounded-full bg-primary px-5 py-2.5 text-center text-sm font-semibold text-white"
                onNavigate={() => setIsOpen(false)}
              />
            )}
          </div>
        </div>
      )}
    </header>
  );
}
