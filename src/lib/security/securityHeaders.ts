// Pure HTTP security header builder — no next/server import, so this is
// directly testable under plain `node --test` (see AGENTS.md's established
// convention of keeping next/server-coupled code out of pure logic).
// Wired in by src/lib/supabase/session.ts (called from every matched
// request via src/proxy.ts), so it applies to every page and app-level
// response in one place rather than being duplicated per-route.
//
// CSP is intentionally NOT nonce-based: nonces require forcing dynamic
// rendering on every route (next.config's own CSP guide — "all pages must
// be dynamically rendered"), which is a much larger change than this task's
// scope. 'unsafe-inline' for script-src/style-src is the documented,
// deliberate exception this implies — Next.js's own hydration/RSC payload
// scripts and Tailwind's injected inline styles would otherwise be blocked.
// 'unsafe-eval' is dev-only (React's eval-based debugging; never in prod).

export interface SecurityHeaderOptions {
  /** True only when the app currently has no analytics/payment/third-party scripts. Re-derive this if that changes. */
  isDev: boolean;
  isHttps: boolean;
  /** Origin (scheme+host[:port]) of the Supabase project this deployment talks to, e.g. "https://abc.supabase.co" or "http://127.0.0.1:54321". */
  supabaseOrigin: string;
}

function supabaseWebSocketOrigin(supabaseOrigin: string): string {
  return supabaseOrigin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
}

export function buildContentSecurityPolicy(options: SecurityHeaderOptions): string {
  const { isDev, supabaseOrigin } = options;
  const wsOrigin = supabaseWebSocketOrigin(supabaseOrigin);
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${supabaseOrigin}`,
    `font-src 'self'`,
    `connect-src 'self' ${supabaseOrigin} ${wsOrigin}`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ];
  if (!isDev) {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join("; ");
}

export function buildSecurityHeaders(options: SecurityHeaderOptions): Array<{ key: string; value: string }> {
  const headers: Array<{ key: string; value: string }> = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy(options) },
  ];
  // HSTS is only meaningful (and only sent) over an actual HTTPS connection —
  // sending it over plain HTTP in local dev would be a no-op at best and
  // misleading at worst. No `preload` directive: that requires a deliberate,
  // separate submission to the browser preload list, not a default to flip on here.
  if (options.isHttps && !options.isDev) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  }
  return headers;
}
