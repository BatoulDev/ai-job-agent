"use client";

import { useSyncExternalStore } from "react";

const DEMO_AUTH_KEY = "ai-job-agent-demo-auth";
const DEMO_AUTH_EVENT = "ai-job-agent-demo-auth-changed";

// Any other demo-only keys we may add later (demo profile, demo name, etc.)
// should be listed here so logout clears them too.
const DEMO_RELATED_KEYS = [DEMO_AUTH_KEY];

export function isDemoLoggedIn(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEMO_AUTH_KEY) === "true";
}

export function setDemoLoggedIn(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DEMO_AUTH_KEY, "true");
  window.dispatchEvent(new Event(DEMO_AUTH_EVENT));
}

export function clearDemoLoggedIn(): void {
  if (typeof window === "undefined") return;
  for (const key of DEMO_RELATED_KEYS) {
    localStorage.removeItem(key);
  }
  window.dispatchEvent(new Event(DEMO_AUTH_EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(DEMO_AUTH_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(DEMO_AUTH_EVENT, callback);
  };
}

export function useIsDemoLoggedIn(): boolean {
  return useSyncExternalStore(subscribe, isDemoLoggedIn, () => false);
}
