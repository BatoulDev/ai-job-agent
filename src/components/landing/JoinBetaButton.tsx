"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSupabaseUser } from "@/lib/supabase/useSupabaseUser";

export default function JoinBetaButton({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { user } = useSupabaseUser();

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onNavigate?.();
    router.push(
      user ? "/onboarding/upload-cv" : "/signup?next=/onboarding/upload-cv"
    );
  };

  return (
    <Link href="/signup" onClick={handleClick} className={className}>
      Join the Beta
    </Link>
  );
}
