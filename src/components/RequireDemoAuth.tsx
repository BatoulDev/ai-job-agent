"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIsDemoLoggedIn } from "@/lib/demoAuth";

export default function RequireDemoAuth({
  redirectTo,
  children,
}: {
  redirectTo: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const isLoggedIn = useIsDemoLoggedIn();

  useEffect(() => {
    if (!isLoggedIn) {
      router.replace(redirectTo);
    }
  }, [isLoggedIn, router, redirectTo]);

  if (!isLoggedIn) return null;
  return <>{children}</>;
}
