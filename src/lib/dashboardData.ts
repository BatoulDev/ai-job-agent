// Automation-1 audit fix (item 7): this file previously exported fixed mock
// job/application data (NEW_MATCHES, APPROVED_JOB, SENT_APPLICATION,
// REJECTED_JOB) that the dashboard rendered unconditionally — including on
// the Approved/Sent tabs, which had no gate at all — implying real matches,
// applications, and a real "Sent Today · Email apply" event that had never
// happened for any user.
//
// Phase 07 (match delivery) wired "New matches" and "Average match score" to
// real data. Phase 08 (cover letters) wired "Cover letters ready" to a real
// count of generated drafts. "Applications sent" stays hardcoded at 0 — no
// application-delivery worker (Phase 09/10) exists yet, so that number is
// genuinely zero for every user today.
import type { MatchWithJob } from "@/lib/matches/types";
import type { CoverLetterRecord } from "@/lib/coverLetters/types";

export function computeDashboardStats(pendingMatches: MatchWithJob[] | null, coverLetters: Record<string, CoverLetterRecord> = {}) {
  const scores = pendingMatches?.map((m) => m.score) ?? [];
  const averageScore = scores.length > 0 ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length) : null;
  const coverLettersReady = Object.values(coverLetters).filter((c) => c.generationStatus === "completed").length;

  return [
    { label: "New matches", value: String(pendingMatches?.length ?? 0) },
    { label: "Average match score", value: averageScore !== null ? `${averageScore}%` : "—" },
    { label: "Cover letters ready", value: String(coverLettersReady) },
    { label: "Applications sent", value: "0" },
  ];
}

export const CV_PROFILE = {
  name: "Jane Doe",
  university: "American University of Beirut",
  major: "Marketing",
  targetRoles: ["Marketing Assistant", "Social Media Coordinator"],
  skills: ["Social media", "Canva", "Copywriting", "Communication"],
  languages: ["English", "Arabic", "French"],
};

export const PREFERENCES_SUMMARY = {
  location: "Beirut, Lebanon",
  remotePreference: "Hybrid / Remote",
  jobType: "Internship or Full-time",
  experienceLevel: "Entry-level / Junior",
  extraDetails: "Open to startups and marketing agencies",
};
