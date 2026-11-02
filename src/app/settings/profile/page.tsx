import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import UpdateNameForm from "./UpdateNameForm";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Update account name — AI Job Guide",
};

export default async function SettingsProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/settings/profile");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  const currentName = profile?.full_name ?? "";

  return (
    <div className="min-h-screen bg-bg">
      <header className="mx-auto max-w-5xl px-6 py-6 lg:px-8">
        <BrandMark />
      </header>

      <main className="mx-auto max-w-xl px-6 pb-20 lg:px-8">
        <div className="mt-10">
          <h1 className="font-display text-2xl font-semibold text-text">
            Update account name
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Your account name is used to verify that the CV you uploaded
            belongs to you. Update it here if it does not match your CV.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-sm">
          <UpdateNameForm initialName={currentName} />
        </div>

        <div className="mt-8 rounded-2xl border border-red-200 bg-white px-6 py-6 shadow-sm">
          <h2 className="text-sm font-semibold text-text">Danger zone</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Permanently delete your account and all associated data.
          </p>
          <Link
            href="/settings/delete-account"
            className="mt-4 inline-flex items-center justify-center rounded-full border border-red-200 px-5 py-2 text-sm font-semibold text-red-700 transition-colors hover:border-red-300 hover:bg-red-50"
          >
            Delete account
          </Link>
        </div>
      </main>
    </div>
  );
}
