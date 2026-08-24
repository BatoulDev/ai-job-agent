"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Shared client-side countdown for the 429 responses returned by
// src/app/api/auth/{login,signup,forgot-password,oauth-init}/route.ts.
// This is a UI courtesy only, never the enforcement itself (that's the
// server/database — see src/lib/authRateLimit/rateLimit.ts) — safe to
// reset freely on user input without weakening anything, since a resubmit
// is simply re-checked and re-armed with a freshly correct value by the
// server regardless of what this local countdown shows.
export function useRetryCountdown() {
  const [retryCountdown, setRetryCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRetryCountdown = useCallback((seconds: number) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setRetryCountdown(seconds);
    countdownRef.current = setInterval(() => {
      setRetryCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const resetRetryCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setRetryCountdown(0);
  }, []);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  return { retryCountdown, startRetryCountdown, resetRetryCountdown };
}
