"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import OnboardingShell from "@/components/onboarding/OnboardingShell";
import FormField from "@/components/auth/FormField";
import Combobox, { type ComboboxOption } from "@/components/ui/Combobox";
import MultiSelectCombobox from "@/components/ui/MultiSelectCombobox";
import { createClient } from "@/lib/supabase/client";
import { EXPERIENCE_LEVEL_OPTIONS } from "@/lib/experienceLevel";
import type { Country } from "@/lib/countries/types";
import { OTHER_UNIVERSITY_VALUE, type University } from "@/lib/universities/types";
import { OTHER_MAJOR_VALUE, type Major } from "@/lib/majors/types";
import { MAX_TARGET_ROLES, type TargetRole } from "@/lib/targetRoles/types";
import type { JobLocation, RelocationLocation } from "@/lib/locations/types";
import type {
  WorkArrangement,
  LebanonLocationScope,
  WorkAuthorizationStatus,
} from "@/lib/jobPreferences/types";
import { setProfileUpdatePending } from "@/lib/optimisticProfileUpdate";

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

const LEBANON_LOCATION_SCOPE_OPTIONS: { value: LebanonLocationScope; label: string; description: string }[] = [
  {
    value: "selected_only",
    label: "Only my selected locations",
    description: "Match on-site/hybrid roles in exactly the cities you pick below.",
  },
  {
    value: "selected_and_nearby",
    label: "My selected locations and nearby areas",
    description: "Also include roles in a small set of areas near the cities you pick.",
  },
  {
    value: "anywhere_in_lebanon",
    label: "Anywhere in Lebanon",
    description: "Match on-site/hybrid roles anywhere in the country.",
  },
];

const WORK_AUTHORIZATION_OPTIONS: { value: WorkAuthorizationStatus; label: string }[] = [
  { value: "needs_employer_support", label: "No — I would need employer visa support" },
  { value: "already_authorized", label: "Yes" },
  { value: "unsure", label: "I'm not sure" },
];

interface ReferenceData {
  universities: University[];
  majors: Major[];
  targetRoles: TargetRole[];
  locations: JobLocation[];
  relocationLocations: RelocationLocation[];
  countries: Country[];
}

// save_job_preferences() (supabase/migrations/20260902090010_plan_aware_job_preferences.sql)
// and the job_preferences eligibility triggers raise a small, stable set
// of known validation/eligibility messages that are safe to show directly
// — every other error (a raw Postgres/Supabase message we don't author)
// must never reach the UI as-is.
const SAFE_PREFERENCES_ERROR_SUBSTRINGS = [
  "invalid or inactive",
  "Select between 1 and 5 target roles",
  "At least one preferred location is required",
  "Please choose how closely",
  "Please specify whether you are willing to relocate",
  "Select at least one location you would be willing to relocate to",
  "Please answer the legal work authorization question",
  "Select at least one country where you already have legal work authorization",
  "International search requires the Pro plan",
  "Relocation locations require the Pro plan",
  "Work authorization requires the Pro plan",
  "not a supported relocation market",
  "relocation market and cannot be used",
  "must match one of your selected relocation locations",
  "relocation locations are invalid or unsupported",
  "authorized countries are invalid",
];

function mapPreferencesError(message: string): string {
  if (message === "Not authenticated") {
    // Handled by a redirect at the call site, not shown as text — this
    // branch only guards against it being passed here by mistake.
    return "Your session has expired. Please log in again and retry.";
  }
  if (SAFE_PREFERENCES_ERROR_SUBSTRINGS.some((s) => message.includes(s))) {
    return message;
  }
  return "We couldn't save your preferences right now. Please try again.";
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
  const [locationError, setLocationError] = useState<string | null>(null);
  const locationInputRef = useRef<HTMLInputElement | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [profileMissing, setProfileMissing] = useState(false);
  const [planCode, setPlanCode] = useState<string | null>(null);

  const [referenceData, setReferenceData] = useState<ReferenceData>({
    universities: [],
    majors: [],
    targetRoles: [],
    locations: [],
    relocationLocations: [],
    countries: [],
  });

  const [universitySelection, setUniversitySelection] = useState<string | null>(null);
  const [customUniversity, setCustomUniversity] = useState("");
  const [majorSelection, setMajorSelection] = useState<string | null>(null);
  const [customMajor, setCustomMajor] = useState("");

  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [customRoles, setCustomRoles] = useState<string[]>([]);

  const [workArrangement, setWorkArrangement] = useState<WorkArrangement | null>(null);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [customLocations, setCustomLocations] = useState<string[]>([]);
  const [lebanonLocationScope, setLebanonLocationScope] = useState<LebanonLocationScope | null>(null);

  // Pro-only international preferences.
  const [internationalSearchEnabled, setInternationalSearchEnabled] = useState(false);
  const [willingToRelocate, setWillingToRelocate] = useState<boolean | null>(null);
  const [relocationLocationIds, setRelocationLocationIds] = useState<string[]>([]);
  const [workAuthorizationStatus, setWorkAuthorizationStatus] = useState<WorkAuthorizationStatus | null>(null);
  const [authorizedCountryIds, setAuthorizedCountryIds] = useState<string[]>([]);
  const [internationalError, setInternationalError] = useState<string | null>(null);

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
        universitiesResult,
        majorsResult,
        targetRolesResult,
        locationsResult,
        relocationLocationsResult,
        countriesResult,
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select("university_id, custom_university, major_id, custom_major")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("job_preferences")
          .select(
            "id, work_arrangement, job_type, experience_level, additional_notes, custom_target_roles, custom_locations, lebanon_location_scope, international_search_enabled, willing_to_relocate, work_authorization_status"
          )
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase.from("subscriptions").select("plan_code").eq("user_id", user.id).maybeSingle(),
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
        supabase
          .from("locations")
          .select("slug, name")
          .eq("is_active", true)
          .eq("is_relocation_market", false)
          .order("sort_order"),
        supabase
          .from("locations")
          .select("slug, name, country_code")
          .eq("is_active", true)
          .eq("is_relocation_market", true)
          .order("sort_order"),
        supabase.from("countries").select("code, name").eq("is_active", true).order("sort_order"),
      ]);

      if (!isMounted) return;

      if (profileResult.error || !profileResult.data) {
        setProfileMissing(true);
        setIsLoading(false);
        return;
      }

      setReferenceData({
        universities: universitiesResult.data ?? [],
        majors: majorsResult.data ?? [],
        targetRoles: targetRolesResult.data ?? [],
        locations: locationsResult.data ?? [],
        relocationLocations: relocationLocationsResult.data ?? [],
        countries: countriesResult.data ?? [],
      });

      const profile = profileResult.data;
      setUniversitySelection(
        profile.university_id ?? (profile.custom_university ? OTHER_UNIVERSITY_VALUE : null)
      );
      setCustomUniversity(profile.custom_university ?? "");
      setMajorSelection(profile.major_id ?? (profile.custom_major ? OTHER_MAJOR_VALUE : null));
      setCustomMajor(profile.custom_major ?? "");

      const plan = subscriptionResult.data?.plan_code ?? null;
      setPlanCode(plan);

      const prefs = prefResult.data;
      if (prefs) {
        setWorkArrangement((prefs.work_arrangement as WorkArrangement | null) ?? null);
        setCustomRoles(prefs.custom_target_roles ?? []);
        setCustomLocations(prefs.custom_locations ?? []);
        setInitialJobType(prefs.job_type ?? "");
        setInitialExperienceLevel(prefs.experience_level ?? "");
        setInitialAdditionalNotes(prefs.additional_notes ?? "");
        setLebanonLocationScope((prefs.lebanon_location_scope as LebanonLocationScope | null) ?? null);
        setInternationalSearchEnabled(!!prefs.international_search_enabled);
        setWillingToRelocate(prefs.willing_to_relocate ?? null);
        setWorkAuthorizationStatus(
          (prefs.work_authorization_status as WorkAuthorizationStatus | null) ?? null
        );

        if (prefs.id) {
          const [roleRowsResult, locationRowsResult, relocationRowsResult, authorizedCountriesResult] =
            await Promise.all([
              supabase
                .from("job_preference_target_roles")
                .select("target_role_id")
                .eq("job_preference_id", prefs.id),
              supabase
                .from("job_preference_locations")
                .select("location_id")
                .eq("job_preference_id", prefs.id),
              supabase
                .from("job_preference_relocation_locations")
                .select("location_id")
                .eq("job_preference_id", prefs.id),
              supabase
                .from("job_preference_authorized_countries")
                .select("country_code")
                .eq("job_preference_id", prefs.id),
            ]);

          if (!isMounted) return;

          setSelectedRoleIds((roleRowsResult.data ?? []).map((r) => r.target_role_id));
          setSelectedLocationIds((locationRowsResult.data ?? []).map((r) => r.location_id));
          setRelocationLocationIds((relocationRowsResult.data ?? []).map((r) => r.location_id));
          setAuthorizedCountryIds((authorizedCountriesResult.data ?? []).map((r) => r.country_code));
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
  const requiresLocation = workArrangement === "onsite" || workArrangement === "hybrid" || workArrangement === "flexible";
  const isPro = planCode === "pro";

  // Countries eligible for "already authorized" are derived only from the
  // relocation locations the user has actually selected — never assumed
  // to transfer to a country they didn't pick for relocation.
  const eligibleAuthorizationCountryCodes = useMemo(() => {
    const codes = new Set(
      referenceData.relocationLocations
        .filter((l) => relocationLocationIds.includes(l.slug))
        .map((l) => l.country_code)
    );
    return codes;
  }, [referenceData.relocationLocations, relocationLocationIds]);

  const eligibleAuthorizationCountries = useMemo(
    () => referenceData.countries.filter((c) => eligibleAuthorizationCountryCodes.has(c.code)),
    [referenceData.countries, eligibleAuthorizationCountryCodes]
  );

  function toggleRelocationLocation(slug: string) {
    const next = relocationLocationIds.includes(slug)
      ? relocationLocationIds.filter((v) => v !== slug)
      : [...relocationLocationIds, slug];
    setRelocationLocationIds(next);
    setInternationalError(null);

    // Removing a relocation location can strand a previously-selected
    // authorized country that's no longer implied by any selected
    // location — drop it here, synchronously with the change that
    // invalidated it, rather than as a separate reactive effect (the
    // server would reject the stale combination anyway).
    const stillEligibleCountryCodes = new Set(
      referenceData.relocationLocations.filter((l) => next.includes(l.slug)).map((l) => l.country_code)
    );
    setAuthorizedCountryIds((prev) => prev.filter((code) => stillEligibleCountryCodes.has(code)));
  }

  function toggleAuthorizedCountry(code: string) {
    setAuthorizedCountryIds((prev) =>
      prev.includes(code) ? prev.filter((v) => v !== code) : [...prev, code]
    );
    setInternationalError(null);
  }

  function handleInternationalSearchChange(enabled: boolean) {
    setInternationalSearchEnabled(enabled);
    setInternationalError(null);
    if (!enabled) {
      // Safely deactivate incompatible child values the moment
      // international search itself is turned off — never leave a stale
      // relocation/authorization selection implying scope that's no
      // longer active.
      setWillingToRelocate(null);
      setRelocationLocationIds([]);
      setWorkAuthorizationStatus(null);
      setAuthorizedCountryIds([]);
    }
  }

  function handleWillingToRelocateChange(value: boolean) {
    setWillingToRelocate(value);
    setInternationalError(null);
    if (!value) {
      setRelocationLocationIds([]);
      setWorkAuthorizationStatus(null);
      setAuthorizedCountryIds([]);
    }
  }

  function handleWorkAuthorizationChange(value: WorkAuthorizationStatus) {
    setWorkAuthorizationStatus(value);
    setInternationalError(null);
    if (value !== "already_authorized") setAuthorizedCountryIds([]);
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    setLocationError(null);
    setInternationalError(null);

    const formData = new FormData(event.currentTarget);
    const jobType = String(formData.get("jobType") ?? "");
    const experienceLevel = String(formData.get("experienceLevel") ?? "");
    const additionalNotes = String(formData.get("additionalNotes") ?? "").trim();

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
    if (!lebanonLocationScope) {
      setErrorMessage("Please choose how closely to follow your selected Lebanese locations.");
      return;
    }
    if (requiresLocation && selectedLocationIds.length === 0 && customLocations.length === 0) {
      setLocationError("Select at least one preferred job location for this work arrangement.");
      locationInputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      locationInputRef.current?.focus();
      return;
    }

    // Client-side mirror of the server-side requirement (defense in
    // depth only — enforce_job_preference_*_eligibility_trigger and
    // save_job_preferences reject an invalid combination regardless).
    if (isPro && internationalSearchEnabled) {
      if (willingToRelocate === null) {
        setInternationalError("Please specify whether you are willing to relocate outside Lebanon.");
        return;
      }
      if (willingToRelocate) {
        if (relocationLocationIds.length === 0) {
          setInternationalError("Select at least one location you would be willing to relocate to.");
          return;
        }
        if (!workAuthorizationStatus) {
          setInternationalError("Please answer the legal work authorization question.");
          return;
        }
        if (workAuthorizationStatus === "already_authorized" && authorizedCountryIds.length === 0) {
          setInternationalError("Select at least one country where you already have legal work authorization.");
          return;
        }
      }
    }

    setIsSaving(true);
    const supabase = createClient();

    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        university_id: universitySelection === OTHER_UNIVERSITY_VALUE ? null : universitySelection,
        custom_university: universitySelection === OTHER_UNIVERSITY_VALUE ? customUniversity.trim() : null,
        major_id: majorSelection === OTHER_MAJOR_VALUE ? null : majorSelection,
        custom_major: majorSelection === OTHER_MAJOR_VALUE ? customMajor.trim() : null,
      })
      .eq("id", userId);

    if (profileError) {
      // Never surface profileError.message (raw Postgres/Supabase text).
      // No bespoke validation trigger exists on profiles for this update —
      // an error here is always an unexpected internal issue.
      setIsSaving(false);
      setErrorMessage("We couldn't save your profile right now. Please try again.");
      return;
    }

    const wantsInternational = isPro && internationalSearchEnabled;
    const wantsRelocation = wantsInternational && willingToRelocate === true;

    const { error: prefError } = await supabase.rpc("save_job_preferences", {
      p_work_arrangement: workArrangement,
      p_job_market_coverage: null,
      p_job_type: jobType,
      p_experience_level: experienceLevel,
      p_additional_notes: additionalNotes || null,
      p_custom_target_roles: customRoles,
      p_custom_locations: customLocations,
      p_target_role_ids: selectedRoleIds,
      p_location_ids: selectedLocationIds,
      p_lebanon_location_scope: lebanonLocationScope,
      p_international_search_enabled: wantsInternational,
      p_willing_to_relocate: wantsInternational ? willingToRelocate : null,
      p_relocation_location_ids: wantsRelocation ? relocationLocationIds : [],
      p_work_authorization_status: wantsRelocation ? workAuthorizationStatus : null,
      p_work_authorization_country_ids:
        wantsRelocation && workAuthorizationStatus === "already_authorized" ? authorizedCountryIds : [],
    });

    if (prefError) {
      setIsSaving(false);
      if (prefError.message === "Not authenticated") {
        router.push("/login?next=/onboarding/preferences");
        return;
      }
      setErrorMessage(mapPreferencesError(prefError.message));
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

    // Signal the dashboard to show an optimistic progress panel before
    // the analysis_tasks row is visible to polling. Only set for the
    // dashboard destination; other nextStep values (plan, upload_cv)
    // don't show the CV profile immediately.
    if (nextStep.startsWith("/dashboard")) {
      try {
        setProfileUpdatePending("preferences_updated");
      } catch {
        // sessionStorage unavailable — degrade gracefully
      }
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
              {WORK_ARRANGEMENT_OPTIONS.map((option) => {
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
                      onChange={() => { setWorkArrangement(option.value); setLocationError(null); }}
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
          </div>

          {requiresLocation && (
            <div>
              {workArrangement === "flexible" && (
                <p className="mb-2 text-xs leading-relaxed text-muted">
                  Flexible includes remote, hybrid, and on-site
                  opportunities — set your preferred Lebanese locations
                  below.
                </p>
              )}
              <MultiSelectCombobox
                id="locations"
                label="Preferred job locations (required)"
                options={locationOptions}
                selectedValues={selectedLocationIds}
                onChange={(vals) => {
                  setSelectedLocationIds(vals);
                  if (vals.length > 0) setLocationError(null);
                }}
                customValues={customLocations}
                onCustomValuesChange={(vals) => {
                  setCustomLocations(vals);
                  if (vals.length > 0) setLocationError(null);
                }}
                placeholder="Search locations..."
                customPlaceholder="Type a location and press Enter"
                error={locationError}
                inputRef={locationInputRef}
              />
            </div>
          )}

          <div>
            <p id="location-scope-label" className="mb-1.5 block text-sm font-medium text-text">
              How closely should we follow your selected Lebanese locations?
            </p>
            <div role="radiogroup" aria-labelledby="location-scope-label" className="space-y-2">
              {LEBANON_LOCATION_SCOPE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors ${
                    lebanonLocationScope === option.value
                      ? "border-primary bg-primary/5"
                      : "border-slate-200 hover:bg-bg"
                  }`}
                >
                  <input
                    type="radio"
                    name="lebanonLocationScope"
                    value={option.value}
                    checked={lebanonLocationScope === option.value}
                    onChange={() => setLebanonLocationScope(option.value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium text-text">{option.label}</span>
                    <span className="block text-xs leading-relaxed text-muted">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

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
            placeholder="e.g. I prefer startups, I am open to internships, I do not want sales roles, I am looking for remote jobs only..."
            required={false}
            helperText="Optional — add any extra details that can help your AI Job Agent find better matches."
            defaultValue={initialAdditionalNotes}
          />

          {isPro && (
            <div id="international-preferences" className="space-y-4 rounded-2xl border border-accent/20 bg-accent/5 p-5">
              <div>
                <h2 className="font-display text-base font-semibold text-text">
                  International job search
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Pro-only. Your Lebanon matching above stays active either
                  way — this section only expands your search beyond
                  Lebanon.
                </p>
              </div>

              {internationalError && (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {internationalError}
                </div>
              )}

              <div>
                <p id="intl-search-label" className="mb-1.5 block text-sm font-medium text-text">
                  Would you like us to search for jobs outside Lebanon?
                </p>
                <div role="radiogroup" aria-labelledby="intl-search-label" className="flex flex-wrap gap-1.5">
                  {[{ value: true, label: "Yes" }, { value: false, label: "No" }].map((option) => (
                    <label
                      key={String(option.value)}
                      className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                        internationalSearchEnabled === option.value
                          ? "bg-primary text-white"
                          : "bg-white text-text hover:bg-slate-100"
                      }`}
                    >
                      <input
                        type="radio"
                        name="internationalSearchEnabled"
                        checked={internationalSearchEnabled === option.value}
                        onChange={() => handleInternationalSearchChange(option.value)}
                        className="sr-only"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>

              {internationalSearchEnabled && (
                <>
                  <div>
                    <p id="relocate-label" className="mb-1.5 block text-sm font-medium text-text">
                      Are you willing to relocate outside Lebanon for the right opportunity?
                    </p>
                    <div role="radiogroup" aria-labelledby="relocate-label" className="flex flex-wrap gap-1.5">
                      {[{ value: true, label: "Yes" }, { value: false, label: "No" }].map((option) => (
                        <label
                          key={String(option.value)}
                          className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                            willingToRelocate === option.value
                              ? "bg-primary text-white"
                              : "bg-white text-text hover:bg-slate-100"
                          }`}
                        >
                          <input
                            type="radio"
                            name="willingToRelocate"
                            checked={willingToRelocate === option.value}
                            onChange={() => handleWillingToRelocateChange(option.value)}
                            className="sr-only"
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                    {willingToRelocate === false && (
                      <p className="mt-1.5 text-xs leading-relaxed text-muted">
                        We&apos;ll search verified international remote roles
                        that accept applicants based in Lebanon — no
                        relocation or work-authorization details needed.
                      </p>
                    )}
                  </div>

                  {willingToRelocate === true && (
                    <>
                      <div>
                        <p id="relocation-locations-label" className="mb-1.5 block text-sm font-medium text-text">
                          Where would you be willing to relocate?
                        </p>
                        <div className="space-y-2">
                          {referenceData.relocationLocations.map((loc) => (
                            <label
                              key={loc.slug}
                              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors ${
                                relocationLocationIds.includes(loc.slug)
                                  ? "border-primary bg-white"
                                  : "border-slate-200 bg-white hover:bg-bg"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={relocationLocationIds.includes(loc.slug)}
                                onChange={() => toggleRelocationLocation(loc.slug)}
                              />
                              <span className="font-medium text-text">{loc.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p id="work-auth-label" className="mb-1.5 block text-sm font-medium text-text">
                          Do you already have legal authorization to work in any of your selected countries?
                        </p>
                        <p className="mb-2 text-xs leading-relaxed text-muted">
                          This may include a work permit, valid relevant
                          residency, citizenship, or another legal right to
                          work.
                        </p>
                        <div role="radiogroup" aria-labelledby="work-auth-label" className="space-y-2">
                          {WORK_AUTHORIZATION_OPTIONS.map((option) => (
                            <label
                              key={option.value}
                              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors ${
                                workAuthorizationStatus === option.value
                                  ? "border-primary bg-white"
                                  : "border-slate-200 bg-white hover:bg-bg"
                              }`}
                            >
                              <input
                                type="radio"
                                name="workAuthorizationStatus"
                                checked={workAuthorizationStatus === option.value}
                                onChange={() => handleWorkAuthorizationChange(option.value)}
                              />
                              <span className="font-medium text-text">{option.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      {workAuthorizationStatus === "already_authorized" && (
                        <div>
                          <p id="authorized-countries-label" className="mb-1.5 block text-sm font-medium text-text">
                            Which of your selected countries?
                          </p>
                          {eligibleAuthorizationCountries.length === 0 ? (
                            <p className="text-xs leading-relaxed text-muted">
                              Select a relocation location above first.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {eligibleAuthorizationCountries.map((country) => (
                                <label
                                  key={country.code}
                                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors ${
                                    authorizedCountryIds.includes(country.code)
                                      ? "border-primary bg-white"
                                      : "border-slate-200 bg-white hover:bg-bg"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={authorizedCountryIds.includes(country.code)}
                                    onChange={() => toggleAuthorizedCountry(country.code)}
                                  />
                                  <span className="font-medium text-text">{country.name}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}

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
