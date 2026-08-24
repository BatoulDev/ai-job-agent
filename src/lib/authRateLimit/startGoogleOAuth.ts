"use client";

import { createClient } from "@/lib/supabase/client";

export interface GoogleOAuthResult {
  ok: boolean;
  error?: string;
  retryAfterSeconds?: number;
}

function parseErrorBody(data: unknown): { error?: string; retryAfterSeconds?: number } {
  if (typeof data !== "object" || data === null) return {};
  const record = data as Record<string, unknown>;
  return {
    error: typeof record.error === "string" ? record.error : undefined,
    retryAfterSeconds: typeof record.retryAfterSeconds === "number" ? record.retryAfterSeconds : undefined,
  };
}

// Shared by login/page.tsx and signup/page.tsx. Checks the server-side/
// database-backed rate limit (src/app/api/auth/oauth-init/route.ts) before
// ever calling supabase.auth.signInWithOAuth() — that call performs a full
// browser redirect to Google itself and has no server round-trip of its
// own to attach a gate to.
export async function startGoogleOAuth(): Promise<GoogleOAuthResult> {
  let gateResponse: Response;
  try {
    gateResponse = await fetch("/api/auth/oauth-init", { method: "POST" });
  } catch {
    return { ok: false, error: "Could not reach the server. Please try again." };
  }

  if (!gateResponse.ok) {
    let data: unknown = null;
    try {
      data = await gateResponse.json();
    } catch {
      // Body wasn't valid JSON — fall through to the generic message below.
    }
    const { error, retryAfterSeconds } = parseErrorBody(data);
    return {
      ok: false,
      error: error ?? "Failed to start Google sign-in. Please try again.",
      retryAfterSeconds,
    };
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });

  if (error) {
    return { ok: false, error: "Failed to start Google sign-in. Please try again." };
  }

  // On success, signInWithOAuth has already triggered the browser redirect
  // to Google — no further action needed by the caller.
  return { ok: true };
}
