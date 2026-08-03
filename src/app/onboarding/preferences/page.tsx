"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import OnboardingShell from "@/components/onboarding/OnboardingShell";
import FormField from "@/components/auth/FormField";
import Combobox, { type ComboboxOption } from "@/components/ui/Combobox";
import MultiSelectCombobox from "@/components/ui/MultiSelectCombobox";
import { createClient } from "@/lib/supabase/client";
import { EXPERIENCE_LEVEL_OPTIONS } from "@/lib/experienceLevel";
import { LEBANON_COUNTRY_CODE, type Country } from "@/lib/countries/types";
import { OTHER_UNIVERSITY_VALUE, type University } from "@/lib/universities/types";
import { OTHER_MAJOR_VALUE, type Major } from "@/lib/majors/types";
import { MAX_TARGET_ROLES, type TargetRole } from "@/lib/targetRoles/types";
import type { JobLocation } from "@/lib/locations/types";
import type { WorkArrangement, JobMarketCoverage } from "@/lib/jobPreferences/types";

const JOB_TYPE_OPTIONS = [
  { label: "Internship", value: "internship" },
  { label: "Part-time", value: "part-time" },
  { label: "Full-time", value: "full-time" },
  { label: "Freelance", value: "freelance" },
  { label: "Open to all", value: "open" },
];

const WORK_ARRANGEMENT_OPTIONS: { value: WorkArrangement; label: string; description: string }[] = [
  { value: "remote", label: "Remote", description: "Interested in remote roles only." },
  {
    value: "onsite",
    label: "On-site",
    description: "Interested in roles performed at a workplace in Lebanon.",
  },
  {
    value: "hybrid",
    label: "Hybrid",
    description: "Interested in roles combining remote and workplace attendance in Lebanon.",
  },
  {
    value: "flexible",
    label: "Flexible",
    description: "Open to remote, hybrid, and on-site opportunities.",
  },
];

const JOB_MARKET_COVERAGE_OPTIONS: { value: JobMarketCoverage; label: string }[] = [
  { value: "lebanon_only", label: "Lebanon only" },
  { value: "remote_lebanon_applicants", label: "Remote roles open to applicants based in Lebanon" },
  { value: "remote_mena", label: "Remote within MENA" },
  { value: "remote_worldwide", label: "Worldwide remote" },
];

interface ReferenceData {
  countries: Country[];
  universities: University[];
  majors: Major[];
  targetRoles: TargetRole[];
  locations: JobLocation[];
}

function toOptions<T extends { name: string }>(
  rows: T[],
  getValue: (row: T) => string,
  getSublabel?: (row: T) => string | undefined
): ComboboxOption[] {
  return rows.map((row) => ({
    value: getValue(row),
    label: row.name,
    sublabel: getSublabel?.(row),
    group: "category" in row ? (row as unknown as { category: string }).category : undefined,
  }));
}

export default function PreferencesPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [profileMissing, setProfileMissing] = useState(false);
  const [planCode, setPlanCode] = useState<string | null>(null);

  const [referenceData, setReferenceData] = useState<ReferenceData>({
    countries: [],
    universities: [],
    majors: [],
    targetRoles: [],
    locations: [],
  });

  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [universitySelection, setUniversitySelection] = useState<string | null>(null);
  const [customUniversity, setCustomUniversity] = useState("");
  const [majorSelection, setMajorSelection] = useState<string | null>(null);
  const [customMajor, setCustomMajor] = useState("");

  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [customRoles, setCustomRoles] = useState<string[]>([]);

  const [workArrangement, setWorkArrangement] = useState<WorkArrangement | null>(null);
  const [jobMarketCoverage, setJobMarketCoverage] = useState<JobMarketCoverage | null>(null);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [customLocations, setCustomLocations] = useState<string[]>([]);

  const [initialJobType, setInitialJobType] = useState("");
  const [initialExperienceLevel, setInitialExperienceLevel] = useState("");
  const [initialAdditionalNotes, setInitialAdditionalNotes] = useState("");

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

      const [
        profileResult,
        prefResult,
        subscriptionResult,
        countriesResult,
        universitiesResult,
        majorsResult,
        targetRolesResult,
        locationsResult,
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select("country_of_residence, university_id, custom_university, major_id, custom_major")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("job_preferences")
          .select(
            "id, work_arrangement, job_market_coverage, job_type, experience_level, additional_notes, custom_target_roles, custom_locations"
          )
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase.from("subscriptions").select("plan_code").eq("user_id", user.id).maybeSingle(),
        supabase.from("countries").select("code, name").eq("is_active", true).order("sort_order"),
        supabase
          .from("universities")
          .select("slug, name, abbreviation")
          .eq("is_active", true)
          .order("sort_order"),
        supabase.from("majors").select("slug, name, category").eq("is_active", true).order("sort_order"),
        supabase
          .from("target_roles")
          .select("slug, name, category")
          .eq("is_active", true)
          .order("sort_order"),
        supabase.from("locations").select("slug, name").eq("is_active", true).order("sort_order"),
      ]);

      if (!isMounted) return;

      if (profileResult.error || !profileResult.data) {
        setProfileMissing(true);
        setIsLoading(false);
        return;
      }

      setReferenceData({
        countries: countriesResult.data ?? [],
        universities: universitiesResult.data ?? [],
        majors: majorsResult.data ?? [],
        targetRoles: targetRolesResult.data ?? [],
        locations: locationsResult.data ?? [],
      });

      const profile = profileResult.data;
      setCountryCode(profile.country_of_residence);
      setUniversitySelection(
        profile.university_id ?? (profile.custom_university ? OTHER_UNIVERSITY_VALUE : null)
      );
      setCustomUniversity(profile.custom_university ?? "");
      setMajorSelection(profile.major_id ?? (profile.custom_major ? OTHER_MAJOR_VALUE : null));
      setCustomMajor(profile.custom_major ?? "");

      setPlanCode(subscriptionResult.data?.plan_code ?? null);

      const prefs = prefResult.data;
      if (prefs) {
        setWorkArrangement((prefs.work_arrangement as WorkArrangement | null) ?? null);
        setJobMarketCoverage((prefs.job_market_coverage as JobMarketCoverage | null) ?? null);
        setCustomRoles(prefs.custom_target_roles ?? []);
        setCustomLocations(prefs.custom_locations ?? []);
        setInitialJobType(prefs.job_type ?? "");
        setInitialExperienceLevel(prefs.experience_level ?? "");
        setInitialAdditionalNotes(prefs.additional_notes ?? "");

        if (prefs.id) {
          const [roleRowsResult, locationRowsResult] = await Promise.all([
            supabase
              .from("job_preference_target_roles")
              .select("target_role_id")
              .eq("job_preference_id", prefs.id),
            supabase
              .from("job_preference_locations")
              .select("location_id")
              .eq("job_preference_id", prefs.id),
          ]);

          if (!isMounted) return;

          setSelectedRoleIds((roleRowsResult.data ?? []).map((r) => r.target_role_id));
          setSelectedLocationIds((locationRowsResult.data ?? []).map((r) => r.location_id));
        }
      }

      setUserId(user.id);
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [router]);

  const isLebanon = countryCode === LEBANON_COUNTRY_CODE;
  const isInternational = !!countryCode && !isLebanon;

  // A manipulated client still can't bypass this — save_job_preferences /
  // enforce_job_preferences_eligibility_trigger reject any non-remote work
  // arrangement or coverage value server-side regardless of what this UI
  // sends. This just keeps the UI itself honest the moment a non-Lebanon
  // country is picked, rather than waiting for a save-time rejection.
  function handleCountryChange(code: string) {
    setCountryCode(code);
    if (code !== LEBANON_COUNTRY_CODE) {
      setWorkArrangement("remote");
      setJobMarketCoverage(null);
    }
  }

  const countryOptions: ComboboxOption[] = useMemo(
    () => referenceData.countries.map((c) => ({ value: c.code, label: c.name })),
    [referenceData.countries]
  );

  const universityOptions: ComboboxOption[] = useMemo(
    () => [
      ...toOptions(referenceData.universities, (u) => u.slug, (u) => u.abbreviation ?? undefined),
      { value: OTHER_UNIVERSITY_VALUE, label: "Other" },
    ],
    [referenceData.universities]
  );

  const majorOptions: ComboboxOption[] = useMemo(
    () => [...toOptions(referenceData.majors, (m) => m.slug), { value: OTHER_MAJOR_VALUE, label: "Other" }],
    [referenceData.majors]
  );

  // Clears stale custom text the moment a real predefined option is
  // chosen — but not while merely browsing the list with "Other" still
  // logically selected underneath (Combobox keeps `value` as the sentinel
  // during that browse, so this only fires on a genuine new selection).
  function handleUniversityChange(newValue: string) {
    setUniversitySelection(newValue);
    if (newValue !== OTHER_UNIVERSITY_VALUE) setCustomUniversity("");
  }

  function handleMajorChange(newValue: string) {
    setMajorSelection(newValue);
    if (newValue !== OTHER_MAJOR_VALUE) setCustomMajor("");
  }

  const targetRoleOptions: ComboboxOption[] = useMemo(
    () => toOptions(referenceData.targetRoles, (r) => r.slug),
    [referenceData.targetRoles]
  );

  const locationOptions: ComboboxOption[] = useMemo(
    () => referenceData.locations.map((l) => ({ value: l.slug, label: l.name })),
    [referenceData.locations]
  );

  const selectedWorkArrangementDescription =
    WORK_ARRANGEMENT_OPTIONS.find((o) => o.value === workArrangement)?.description ?? null;

  const totalRoleCount = selectedRoleIds.length + customRoles.length;
  const requiresPhysicalLocation = workArrangement === "onsite" || workArrangement === "hybrid";
  const showLocationControls = isLebanon && (requiresPhysicalLocation || workArrangement === "flexible");
  const showCoveragePicker =
    isLebanon && planCode === "pro" && (workArrangement === "remote" || workArrangement === "flexible");
  // Shown across every work arrangement (not just remote/flexible) — a
  // Student user must never assume Remote means MENA/worldwide coverage.
  const showStudentCoverageNotice = isLebanon && planCode === "student" && !!workArrangement;
  const showResidenceChangeWarning = isInternational && planCode === "student";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    const formData = new FormData(event.currentTarget);
    const jobType = String(formData.get("jobType") ?? "");
    const experienceLevel = String(formData.get("experienceLevel") ?? "");
    const additionalNotes = String(formData.get("additionalNotes") ?? "").trim();

    if (!countryCode) {
      setErrorMessage("Please select your country of residence.");
      return;
    }
    if (!universitySelection || (universitySelection === OTHER_UNIVERSITY_VALUE && !customUniversity.trim())) {
      setErrorMessage("Please select your university, or enter it if it's not listed.");
      return;
    }
    if (!majorSelection || (majorSelection === OTHER_MAJOR_VALUE && !customMajor.trim())) {
      setErrorMessage("Please select your major, or enter it if it's not listed.");
      return;
    }
    if (totalRoleCount < 1 || totalRoleCount > MAX_TARGET_ROLES) {
      setErrorMessage(`Please select between 1 and ${MAX_TARGET_ROLES} target roles.`);
      return;
    }
    if (!workArrangement) {
      setErrorMessage("Please select a work arrangement.");
      return;
    }
    if (!jobType || !experienceLevel) {
      setErrorMessage("Please select a job type and experience level.");
      return;
    }
    if (
      isLebanon &&
      requiresPhysicalLocation &&
      selectedLocationIds.length === 0 &&
      customLocations.length === 0
    ) {
      setErrorMessage("Please select at least one preferred location for On-site or Hybrid.");
      return;
    }

    setIsSaving(true);
    const supabase = createClient();

    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        country_of_residence: countryCode,
        university_id: universitySelection === OTHER_UNIVERSITY_VALUE ? null : universitySelection,
        custom_university: universitySelection === OTHER_UNIVERSITY_VALUE ? customUniversity.trim() : null,
        major_id: majorSelection === OTHER_MAJOR_VALUE ? null : majorSelection,
        custom_major: majorSelection === OTHER_MAJOR_VALUE ? customMajor.trim() : null,
      })
      .eq("id", userId);

    if (profileError) {
      setErrorMessage(`Could not save your profile: ${profileError.message}`);
      setIsSaving(false);
      return;
    }

    const { error: prefError } = await supabase.rpc("save_job_preferences", {
      p_work_arrangement: workArrangement,
      p_job_market_coverage: showCoveragePicker ? jobMarketCoverage : null,
      p_job_type: jobType,
      p_experience_level: experienceLevel,
      p_additional_notes: additionalNotes || null,
      p_custom_target_roles: customRoles,
      p_custom_locations: showLocationControls ? customLocations : [],
      p_target_role_ids: selectedRoleIds,
      p_location_ids: showLocationControls ? selectedLocationIds : [],
    });

    if (prefError) {
      setErrorMessage(`Could not save your preferences: ${prefError.message}`);
      setIsSaving(false);
      return;
    }

    setSuccessMessage("Preferences saved.");

    let nextStep = "/dashboard?tab=cv-profile";
    try {
      const response = await fetch("/api/onboarding/complete", { method: "POST" });
      if (response.ok) {
        const data = (await response.json()) as { nextStep?: string };
        if (data.nextStep === "plan") nextStep = "/#pricing";
        else if (data.nextStep === "upload_cv") nextStep = "/onboarding/upload-cv";
      }
    } catch {
      // Ignore — fall back to the CV Profile tab below.
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
        <form onSubmit={handleSubmit} className="space-y-4">
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

          <Combobox
            id="country"
            label="Country of residence"
            options={countryOptions}
            value={countryCode}
            onChange={handleCountryChange}
            placeholder="Search countries..."
            required
            helperText="Your country of residence helps us find remote jobs that accept applicants from your location."
          />

          {isInternational && (
            <div
              role="status"
              className="rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm leading-relaxed text-text"
            >
              Currently, users outside Lebanon can use the Pro plan for
              remote opportunities available to applicants in their
              country. Local on-site and hybrid opportunities outside
              Lebanon are not supported yet.
            </div>
          )}

          {showResidenceChangeWarning && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700"
            >
              Your account currently has the Student plan, which is only
              supported for users residing in Lebanon. We have not changed,
              cancelled, or billed your subscription — matching for your
              account will stay limited until this is resolved. Please
              contact support to review your plan.
            </div>
          )}

          <Combobox
            id="university"
            label="University"
            options={universityOptions}
            value={universitySelection}
            onChange={handleUniversityChange}
            placeholder="Search universities..."
            required
            otherValue={OTHER_UNIVERSITY_VALUE}
            customValue={customUniversity}
            onCustomValueChange={setCustomUniversity}
            customPlaceholder="Type your university"
          />

          <Combobox
            id="major"
            label="Major / field of study"
            options={majorOptions}
            value={majorSelection}
            onChange={handleMajorChange}
            placeholder="Search majors..."
            required
            otherValue={OTHER_MAJOR_VALUE}
            customValue={customMajor}
            onCustomValueChange={setCustomMajor}
            customPlaceholder="Type your major"
          />

          <MultiSelectCombobox
            id="targetRoles"
            label={`Target roles (${totalRoleCount}/${MAX_TARGET_ROLES})`}
            options={targetRoleOptions}
            selectedValues={selectedRoleIds}
            onChange={setSelectedRoleIds}
            customValues={customRoles}
            onCustomValuesChange={setCustomRoles}
            maxSelections={MAX_TARGET_ROLES}
            placeholder="Search roles..."
            customPlaceholder="Type a role and press Enter"
          />

          <div>
            <p id="work-arrangement-label" className="mb-1.5 block text-sm font-medium text-text">
              Work arrangement
            </p>
            <div role="radiogroup" aria-labelledby="work-arrangement-label" className="flex flex-wrap gap-1.5">
              {(isInternational
                ? WORK_ARRANGEMENT_OPTIONS.filter((o) => o.value === "remote")
                : WORK_ARRANGEMENT_OPTIONS
              ).map((option) => {
                const isSelected = workArrangement === option.value;
                return (
                  <label
                    key={option.value}
                    className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40 has-[:focus-visible]:ring-offset-1 ${
                      isSelected ? "bg-primary text-white" : "bg-bg text-text hover:bg-slate-100"
                    }`}
                  >
                    <input
                      type="radio"
                      name="workArrangement"
                      value={option.value}
                      checked={isSelected}
                      onChange={() => setWorkArrangement(option.value)}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
            {selectedWorkArrangementDescription && (
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                {selectedWorkArrangementDescription}
              </p>
            )}
            {isInternational && (
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                Remote is currently the only supported work arrangement
                outside Lebanon. International on-site/hybrid coverage may
                be added later.
              </p>
            )}
          </div>

          {showStudentCoverageNotice && (
            <div className="rounded-xl border border-slate-200 bg-bg px-4 py-3 text-sm text-text">
              Lebanon only — included in your Student plan.
            </div>
          )}

          {showCoveragePicker && (
            <div>
              <p className="mb-1.5 block text-sm font-medium text-text">Job-market coverage</p>
              <p className="mb-2 text-xs leading-relaxed text-muted">
                Pro gives you access to remote opportunities that accept
                applicants from your country of residence. A job labeled
                &quot;Worldwide remote&quot; must still explicitly accept
                applicants residing in Lebanon or have compatible country,
                legal, and time-zone requirements — it does not mean every
                job labeled Remote.
              </p>
              <div className="space-y-2">
                {JOB_MARKET_COVERAGE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors ${
                      jobMarketCoverage === option.value
                        ? "border-primary bg-primary/5"
                        : "border-slate-200 hover:bg-bg"
                    }`}
                  >
                    <input
                      type="radio"
                      name="jobMarketCoverage"
                      value={option.value}
                      checked={jobMarketCoverage === option.value}
                      onChange={() => setJobMarketCoverage(option.value)}
                    />
                    <span className="font-medium text-text">{option.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {isInternational && planCode === "pro" && (
            <p className="text-xs leading-relaxed text-muted">
              Pro gives you access to remote opportunities that accept
              applicants from your country of residence.
            </p>
          )}

          {showLocationControls && (
            <div>
              {workArrangement === "flexible" && (
                <p className="mb-2 text-xs leading-relaxed text-muted">
                  Flexible includes remote, hybrid, and on-site
                  opportunities — set both your remote coverage above and
                  your preferred Lebanese locations below as relevant.
                </p>
              )}
              <MultiSelectCombobox
                id="locations"
                label={`Preferred job locations${requiresPhysicalLocation ? " (required)" : ""}`}
                options={locationOptions}
                selectedValues={selectedLocationIds}
                onChange={setSelectedLocationIds}
                customValues={customLocations}
                onCustomValuesChange={setCustomLocations}
                placeholder="Search locations..."
                customPlaceholder="Type a location and press Enter"
              />
            </div>
          )}

          <FormField
            id="jobType"
            label="Job type"
            type="select"
            options={JOB_TYPE_OPTIONS}
            defaultValue={initialJobType}
          />
          <FormField
            id="experienceLevel"
            label="Experience level"
            type="select"
            options={EXPERIENCE_LEVEL_OPTIONS}
            defaultValue={initialExperienceLevel}
          />
          <FormField
            id="additionalNotes"
            label="Anything else we should know?"
            type="textarea"
            placeholder="e.g. I prefer startups, I am open to internships, I do not want sales roles, I can relocate to Beirut, I am looking for remote jobs only..."
            required={false}
            helperText="Optional — add any extra details that can help your AI Job Agent find better matches."
            defaultValue={initialAdditionalNotes}
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
              {isSaving ? "Saving your preferences…" : "Save & Review AI Profile"}
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
