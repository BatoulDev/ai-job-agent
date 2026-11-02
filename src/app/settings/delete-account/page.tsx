import { redirect } from "next/navigation";
import type { Metadata } from "next";
import BrandMark from "@/components/BrandMark";
import { createClient } from "@/lib/supabase/server";
import { decodeJwtIssuedAt, isSessionFresh } from "@/lib/account/sessionFreshness";
import DeleteAccountForm from "./DeleteAccountForm";

export const metadata: Metadata = {
  title: "Delete account — AI Job Guide",
};

export default async function DeleteAccountPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/settings/delete-account");
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const issuedAt = session ? decodeJwtIssuedAt(session.access_token) : null;
  const initiallyFresh = issuedAt !== null && isSessionFresh(issuedAt);
  const provider = user.app_metadata?.provider === "google" ? "google" : "password";

  return (
    <div className="min-h-screen bg-bg">
      <header className="mx-auto max-w-5xl px-6 py-6 lg:px-8">
        <BrandMark />
      </header>

      <main className="mx-auto max-w-xl px-6 pb-20 lg:px-8">
        <div className="mt-10">
          <h1 className="font-display text-2xl font-semibold text-text">
            Delete your account
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            This permanently deletes your account, uploaded CV, AI career profile, job
            preferences, matches, cover letters, and application history. This cannot be undone,
            and takes effect immediately.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-sm">
          <DeleteAccountForm provider={provider} initiallyFresh={initiallyFresh} />
        </div>
      </main>
    </div>
  );
}
