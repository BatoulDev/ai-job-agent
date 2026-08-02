import Link from "next/link";
import { SECTION_NAV_LINKS } from "@/lib/navLinks";

export default function Footer() {
  return (
    <footer className="border-t border-slate-200/70 bg-bg">
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent">
                <span className="h-2 w-2 rounded-full bg-white" />
              </span>
              <span className="font-display text-base font-semibold text-text">
                AI Job Agent
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Helping students and fresh graduates in Lebanon find jobs that
              actually fit, with daily matches and approval-first
              applications.
            </p>
          </div>

          <div className="flex gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Product
              </p>
              <ul className="mt-3 space-y-2">
                {SECTION_NAV_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted transition-colors hover:text-text"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-slate-200/70 pt-6 text-sm text-muted">
          © {new Date().getFullYear()} AI Job Agent. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
