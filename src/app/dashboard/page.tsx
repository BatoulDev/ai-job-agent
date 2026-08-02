"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import DashboardTabs, {
  type DashboardTab,
} from "@/components/dashboard/DashboardTabs";
import StatsGrid from "@/components/dashboard/StatsGrid";
import TrustNote from "@/components/dashboard/TrustNote";
import NewMatchesSection from "@/components/dashboard/NewMatchesSection";
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

const TABS: DashboardTab[] = [
  { id: "new-matches", label: "New Matches" },
  { id: "approved", label: "Approved" },
  { id: "sent", label: "Sent" },
  { id: "rejected", label: "Rejected" },
  { id: "cv-profile", label: "CV Profile" },
  { id: "preferences", label: "Preferences" },
];

export default function DashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<string>("new-matches");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<PreferencesData | null>(null);
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
          .select("full_name")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("job_preferences")
          .select(
            "target_roles, location, remote_preference, job_type, experience_level, additional_notes"
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

      setEmail(user.email ?? "");
      setFullName(profileResult.data.full_name);
      setPreferences(
        prefResult.data
          ? {
              targetRoles: prefResult.data.target_roles,
              location: prefResult.data.location,
              remotePreference: prefResult.data.remote_preference,
              jobType: prefResult.data.job_type,
              experienceLevel: prefResult.data.experience_level,
              additionalNotes: prefResult.data.additional_notes,
            }
          : null
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
            {activeTab === "new-matches" && <NewMatchesSection />}
            {activeTab === "approved" && <ApprovedSection />}
            {activeTab === "sent" && <SentSection />}
            {activeTab === "rejected" && <RejectedSection />}
            {activeTab === "cv-profile" && (
              <CvProfileSection
                cv={cv}
                preferences={preferences}
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
