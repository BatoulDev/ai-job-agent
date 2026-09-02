// Automation-1 audit fix (item 7): this file previously exported fixed mock
// job/application data (NEW_MATCHES, APPROVED_JOB, SENT_APPLICATION,
// REJECTED_JOB) that the dashboard rendered unconditionally — including on
// the Approved/Sent tabs, which had no gate at all — implying real matches,
// applications, and a real "Sent Today · Email apply" event that had never
// happened for any user. No job-ingestion or matching worker exists yet
// (that is Automation 2's job), so every one of these numbers is genuinely
// zero for every user today. DASHBOARD_STATS now reflects that truthfully;
// the four job/application tabs render an honest empty state (see
// src/components/dashboard/EmptyTabState.tsx) instead of fabricated cards.
export const DASHBOARD_STATS = [
  { label: "New matches", value: "0" },
  { label: "Average match score", value: "—" },
  { label: "Cover letters ready", value: "0" },
  { label: "Applications sent", value: "0" },
];

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
