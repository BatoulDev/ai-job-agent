"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import DashboardTabs, {
  type DashboardTab,
} from "@/components/dashboard/DashboardTabs";
import StatsGrid from "@/components/dashboard/StatsGrid";
import TrustNote from "@/components/dashboard/TrustNote";
import NewMatchesSection from "@/components/dashboard/NewMatchesSection";
import LockedMatchesNotice from "@/components/dashboard/LockedMatchesNotice";
import ApprovedSection from "@/components/dashboard/ApprovedSection";
import SentSection from "@/components/dashboard/SentSection";
import RejectedSection from "@/components/dashboard/RejectedSection";
import CvProfileSection, {
  type CvRecord,
} from "@/components/dashboard/CvProfileSection";
import PreferencesSection, {
  type PreferencesData,
} from "@/components/dashboard/PreferencesSection";
import { DASHBOARD_STATS } from "@/lib/dashboardData";
import { createClient } from "@/lib/supabase/client";
import type { CvAnalysis } from "@/lib/cvAnalysis/types";
import type { AnalysisTaskStatus } from "@/lib/analysisTasks/types";
import { isPreferencesComplete } from "@/lib/cvAnalysis/profileState";

const TABS: DashboardTab[] = [
  { id: "new-matches", label: "New Matches" },
  { id: "approved", label: "Approved" },
  { id: "sent", label: "Sent" },
  { id: "rejected", label: "Rejected" },
  { id: "cv-profile", label: "CV Profile" },
  { id: "preferences", label: "Preferences" },
];
const TAB_IDS = new Set(TABS.map((tab) => tab.id));
const DEFAULT_TAB = "new-matches";

function DashboardPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<string>(
    requestedTab && TAB_IDS.has(requestedTab) ? requestedTab : DEFAULT_TAB
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<PreferencesData | null>(null);
  const [preferencesComplete, setPreferencesComplete] = useState(false);
  const [cv, setCv] = useState<CvRecord | null>(null);
  const [taskStatus, setTaskStatus] = useState<AnalysisTaskStatus | null>(null);
  const [analysis, setAnalysis] = useState<CvAnalysis | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        router.replace("/login");
        return;
      }

      const [profileResult, prefResult, cvResult] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "full_name, country_of_residence, university_id, custom_university, major_id, custom_major"
          )
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("job_preferences")
          .select(
            "id, work_arrangement, job_type, experience_level, additional_notes, job_market_coverage, custom_target_roles, custom_locations"
          )
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("cvs")
          .select("id, file_name, file_size_bytes, status, storage_path, is_active, created_at")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .maybeSingle(),
      ]);

      if (!isMounted) return;

      if (profileResult.error || !profileResult.data) {
        setLoadError(
          "We couldn't load your profile. This usually indicates a signup trigger problem — please contact support."
        );
        setIsLoading(false);
        return;
      }

      const profile = profileResult.data;
      const prefs = prefResult.data;

      // Role/location names now live in join tables — fetch the selected
      // reference rows' display names alongside the custom_* free-text
      // arrays already loaded above.
      let selectedRoleNames: string[] = [];
      let selectedLocationNames: string[] = [];
      if (prefs?.id) {
        const [roleRowsResult, locationRowsResult] = await Promise.all([
          supabase
            .from("job_preference_target_roles")
            .select("target_roles(name)")
            .eq("job_preference_id", prefs.id),
          supabase
            .from("job_preference_locations")
            .select("locations(name)")
            .eq("job_preference_id", prefs.id),
        ]);

        if (!isMounted) return;

        selectedRoleNames = (roleRowsResult.data ?? [])
          .map((row) => (row.target_roles as unknown as { name: string } | null)?.name)
          .filter((name): name is string => !!name);
        selectedLocationNames = (locationRowsResult.data ?? [])
          .map((row) => (row.locations as unknown as { name: string } | null)?.name)
          .filter((name): name is string => !!name);
      }

      const allRoleNames = [...selectedRoleNames, ...(prefs?.custom_target_roles ?? [])];
      const allLocationNames = [...selectedLocationNames, ...(prefs?.custom_locations ?? [])];

      setEmail(user.email ?? "");
      setFullName(profile.full_name);
      setPreferences(
        prefs
          ? {
              targetRoles: allRoleNames.length > 0 ? allRoleNames.join(", ") : null,
              location: allLocationNames.length > 0 ? allLocationNames.join(", ") : null,
              workArrangement: prefs.work_arrangement,
              jobType: prefs.job_type,
              experienceLevel: prefs.experience_level,
              additionalNotes: prefs.additional_notes,
            }
          : null
      );
      setPreferencesComplete(
        isPreferencesComplete({
          countryOfResidence: profile.country_of_residence,
          hasUniversity: !!(profile.university_id || profile.custom_university),
          hasMajor: !!(profile.major_id || profile.custom_major),
          hasTargetRole: allRoleNames.length > 0,
          workArrangement: prefs?.work_arrangement ?? null,
          jobType: prefs?.job_type ?? null,
          experienceLevel: prefs?.experience_level ?? null,
          hasLocation: allLocationNames.length > 0,
        })
      );

      const activeCv = cvResult.data;
      setCv(
        activeCv
          ? {
              id: activeCv.id,
              fileName: activeCv.file_name,
              fileSizeBytes: activeCv.file_size_bytes,
              status: activeCv.status,
              storagePath: activeCv.storage_path,
              createdAt: activeCv.created_at,
            }
          : null
      );

      // Both queries below depend on the active CV's id, so they can only
      // run once the cvs query above has resolved. Most-recent-first: the
      // latest task/analysis for this CV is the one relevant to display
      // (see src/lib/cvAnalysis/profileState.ts for how these combine
      // into a single UI state).
      if (activeCv) {
        const [taskResult, analysisResult] = await Promise.all([
          supabase
            .from("analysis_tasks")
            .select("status")
            .eq("cv_id", activeCv.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("cv_analyses")
            .select("*")
            .eq("cv_id", activeCv.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        if (!isMounted) return;

        setTaskStatus(taskResult.data?.status ?? null);
        setAnalysis((analysisResult.data as CvAnalysis | null) ?? null);
      }

      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <p className="text-sm text-muted">Loading your dashboard...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-6">
        <div className="max-w-md rounded-3xl border border-red-200 bg-red-50 p-8 text-center">
          <p className="text-sm text-red-700">{loadError}</p>
        </div>
      </div>
    );
  }

  const displayName = fullName || email;
  // "Get matches" stays locked until the user's latest CURRENT analysis
  // has been approved — no job matching exists yet, so this is never
  // true for a real user today (see LockedMatchesNotice).
  const isProfileApproved = analysis?.review_status === "approved" && analysis?.is_current === true;

  return (
    <div className="min-h-screen bg-bg">
      <DashboardHeader displayName={displayName} />

      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-text sm:text-3xl">
            Your job matches
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
            Here are the best opportunities your AI Job Agent found based on
            your CV and preferences.
          </p>
        </div>

        <StatsGrid stats={DASHBOARD_STATS} />

        <div className="mt-8 flex flex-col gap-8 lg:flex-row">
          <DashboardTabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

          <main className="min-w-0 flex-1 space-y-8">
            {activeTab === "new-matches" &&
              (isProfileApproved ? (
                <NewMatchesSection />
              ) : (
                <LockedMatchesNotice onReviewProfile={() => setActiveTab("cv-profile")} />
              ))}
            {activeTab === "approved" && <ApprovedSection />}
            {activeTab === "sent" && <SentSection />}
            {activeTab === "rejected" && <RejectedSection />}
            {activeTab === "cv-profile" && (
              <CvProfileSection
                cv={cv}
                preferences={preferences}
                preferencesComplete={preferencesComplete}
                taskStatus={taskStatus}
                analysis={analysis}
                onNavigateToPreferences={() => setActiveTab("preferences")}
              />
            )}
            {activeTab === "preferences" && (
              <PreferencesSection preferences={preferences} />
            )}

            <TrustNote emphasized>
              Your AI Job Agent prepares matches and cover letters, but
              nothing is sent without your approval. LinkedIn jobs are always
              manual apply.
            </TrustNote>
          </main>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardPageContent />
    </Suspense>
  );
}
