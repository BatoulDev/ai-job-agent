"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./client";

interface SupabaseUserState {
  user: User | null;
  isLoading: boolean;
}

// Reactive client-side auth state for UI that must update immediately on
// login/logout (e.g. the landing page Navbar and "Join the Beta" CTAs).
// This is for display/navigation decisions only — it is not an
// authorization check. Route protection (src/proxy.ts) and RLS are what
// actually enforce access.
export function useSupabaseUser(): SupabaseUserState {
  const [state, setState] = useState<SupabaseUserState>({
    user: null,
    isLoading: true,
  });

  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (isMounted) setState({ user, isLoading: false });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) setState({ user: session?.user ?? null, isLoading: false });
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}
