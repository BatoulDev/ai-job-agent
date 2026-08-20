import { redirect } from "next/navigation";
import type { Metadata } from "next";
import BrandMark from "@/components/BrandMark";
import UpdateNameForm from "./UpdateNameForm";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Update account name — AI Job Agent",
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
      </main>
    </div>
  );
}
