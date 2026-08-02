"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import OnboardingShell from "@/components/onboarding/OnboardingShell";
import FormField from "@/components/auth/FormField";
import { createClient } from "@/lib/supabase/client";

const REMOTE_PREFERENCE_OPTIONS = [
  { label: "On-site", value: "onsite" },
  { label: "Hybrid", value: "hybrid" },
  { label: "Remote", value: "remote" },
  { label: "Open to all", value: "open" },
];

const JOB_TYPE_OPTIONS = [
  { label: "Internship", value: "internship" },
  { label: "Part-time", value: "part-time" },
  { label: "Full-time", value: "full-time" },
  { label: "Freelance", value: "freelance" },
  { label: "Open to all", value: "open" },
];

const EXPERIENCE_LEVEL_OPTIONS = [
  { label: "Internship", value: "internship" },
  { label: "Entry-level", value: "entry-level" },
  { label: "Junior", value: "junior" },
];

interface InitialValues {
  university: string;
  major: string;
  targetRoles: string;
  location: string;
  remotePreference: string;
  jobType: string;
  experienceLevel: string;
  additionalNotes: string;
}

const EMPTY_VALUES: InitialValues = {
  university: "",
  major: "",
  targetRoles: "",
  location: "",
  remotePreference: "",
  jobType: "",
  experienceLevel: "",
  additionalNotes: "",
};

export default function PreferencesPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [initialValues, setInitialValues] = useState<InitialValues>(EMPTY_VALUES);
  const [profileMissing, setProfileMissing] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.replace("/login?next=/onboarding/preferences");
        return;
      }

      const { data: profileRow, error: profileError } = await supabase
        .from("profiles")
        .select("university, major")
        .eq("id", user.id)
        .maybeSingle();

      if (!isMounted) return;

      if (profileError || !profileRow) {
        // The signup trigger should have created this row already. If it's
        // missing, something is wrong upstream — do not silently create one
        // here, since that could produce inconsistent/duplicate data.
        setProfileMissing(true);
        setIsLoading(false);
        return;
      }

      const { data: prefRow } = await supabase
        .from("job_preferences")
        .select(
          "target_roles, location, remote_preference, job_type, experience_level, additional_notes"
        )
        .eq("user_id", user.id)
        .maybeSingle();

      if (!isMounted) return;

      setUserId(user.id);
      setInitialValues({
        university: profileRow.university ?? "",
        major: profileRow.major ?? "",
        targetRoles: prefRow?.target_roles ?? "",
        location: prefRow?.location ?? "",
        remotePreference: prefRow?.remote_preference ?? "",
        jobType: prefRow?.job_type ?? "",
        experienceLevel: prefRow?.experience_level ?? "",
        additionalNotes: prefRow?.additional_notes ?? "",
      });
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    const formData = new FormData(event.currentTarget);
    const university = String(formData.get("university") ?? "").trim();
    const major = String(formData.get("major") ?? "").trim();
    const targetRoles = String(formData.get("targetRoles") ?? "").trim();
    const location = String(formData.get("location") ?? "").trim();
    const remotePreference = String(formData.get("remotePreference") ?? "");
    const jobType = String(formData.get("jobType") ?? "");
    const experienceLevel = String(formData.get("experienceLevel") ?? "");
    const additionalNotes = String(formData.get("additionalNotes") ?? "").trim();

    if (!remotePreference || !jobType || !experienceLevel) {
      setErrorMessage(
        "Please select a remote preference, job type, and experience level."
      );
      return;
    }

    setIsSaving(true);
    const supabase = createClient();

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ university: university || null, major: major || null })
      .eq("id", userId);

    if (profileError) {
      setErrorMessage(`Could not save your profile: ${profileError.message}`);
      setIsSaving(false);
      return;
    }

    const { error: prefError } = await supabase.from("job_preferences").upsert(
      {
        user_id: userId,
        target_roles: targetRoles || null,
        location: location || null,
        remote_preference: remotePreference,
        job_type: jobType,
        experience_level: experienceLevel,
        additional_notes: additionalNotes || null,
      },
      { onConflict: "user_id" }
    );

    if (prefError) {
      setErrorMessage(`Could not save your preferences: ${prefError.message}`);
      setIsSaving(false);
      return;
    }

    setSuccessMessage("Preferences saved.");

    // Tells the trusted server-side readiness check to re-evaluate and, if
    // the user is now fully ready, safely enqueue an analysis task (never
    // duplicated on refresh/resubmit — see src/app/api/onboarding/complete).
    // Falls back to /dashboard if this call fails; it never blocks
    // onboarding completion since preferences were already saved above.
    let nextStep = "/dashboard";
    try {
      const response = await fetch("/api/onboarding/complete", { method: "POST" });
      if (response.ok) {
        const data = (await response.json()) as { nextStep?: string };
        if (data.nextStep === "plan") nextStep = "/#pricing";
        else if (data.nextStep === "upload_cv") nextStep = "/onboarding/upload-cv";
      }
    } catch {
      // Ignore — fall back to /dashboard below.
    }

    setIsSaving(false);
    router.push(nextStep);
  };

  if (isLoading) {
    return (
      <OnboardingShell currentStep={3}>
        <p className="text-center text-sm text-muted">Loading your preferences...</p>
      </OnboardingShell>
    );
  }

  if (profileMissing) {
    return (
      <OnboardingShell currentStep={3}>
        <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-center">
          <h1 className="font-display text-xl font-semibold text-red-700">
            We couldn&apos;t find your profile
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-red-700">
            Your account exists, but the profile record that should have been
            created automatically at signup is missing. This points to a
            problem with the signup trigger rather than something we can fix
            by retrying — please contact support instead of creating a new
            account.
          </p>
        </div>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell currentStep={3}>
      <div className="text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
          Set your job preferences
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted">
          Tell your AI Job Agent what kind of opportunities you want, so we
          can match your CV with better jobs.
        </p>
      </div>

      <div className="mt-10 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <form onSubmit={handleSubmit} className="space-y-5">
          {errorMessage && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {errorMessage}
            </div>
          )}
          {successMessage && (
            <div
              role="status"
              className="rounded-xl border border-success/20 bg-success/5 px-4 py-3 text-sm text-text"
            >
              {successMessage}
            </div>
          )}

          <FormField
            id="university"
            label="University"
            placeholder="e.g. American University of Beirut"
            required={false}
            defaultValue={initialValues.university}
          />
          <FormField
            id="major"
            label="Major / field of study"
            placeholder="e.g. Computer Science"
            required={false}
            defaultValue={initialValues.major}
          />
          <FormField
            id="targetRoles"
            label="Target roles"
            placeholder="e.g. Frontend Developer, Marketing Assistant"
            required={false}
            defaultValue={initialValues.targetRoles}
          />
          <FormField
            id="location"
            label="Preferred location"
            placeholder="e.g. Beirut, Lebanon"
            required={false}
            defaultValue={initialValues.location}
          />
          <FormField
            id="remotePreference"
            label="Remote preference"
            type="select"
            options={REMOTE_PREFERENCE_OPTIONS}
            defaultValue={initialValues.remotePreference}
          />
          <FormField
            id="jobType"
            label="Job type"
            type="select"
            options={JOB_TYPE_OPTIONS}
            defaultValue={initialValues.jobType}
          />
          <FormField
            id="experienceLevel"
            label="Experience level"
            type="select"
            options={EXPERIENCE_LEVEL_OPTIONS}
            defaultValue={initialValues.experienceLevel}
          />
          <FormField
            id="additionalNotes"
            label="Anything else we should know?"
            type="textarea"
            placeholder="e.g. I prefer startups, I am open to internships, I do not want sales roles, I can relocate to Beirut, I am looking for remote jobs only..."
            required={false}
            helperText="Optional — add any extra details that can help your AI Job Agent find better matches."
            defaultValue={initialValues.additionalNotes}
          />

          <p className="text-xs leading-relaxed text-muted">
            These preferences help your AI Job Agent avoid irrelevant jobs.
            You can edit them later from your dashboard.
          </p>

          <div className="flex flex-col items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Continue to dashboard"}
            </button>
            <Link
              href="/onboarding/upload-cv"
              className="text-sm font-medium text-muted hover:text-text"
            >
              Back to Upload CV
            </Link>
          </div>
        </form>
      </div>
    </OnboardingShell>
  );
}
