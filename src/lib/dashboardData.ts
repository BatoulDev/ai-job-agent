export type MatchSource = "Company careers" | "Email apply" | "LinkedIn manual";

export interface JobMatch {
  id: string;
  title: string;
  company: string;
  location: string;
  source: MatchSource;
  matchScore: number;
  whyItMatches: string[];
  missingSkills: string[];
  coverLetterPreview: string;
}

export const DASHBOARD_STATS = [
  { label: "New matches", value: "3" },
  { label: "Average match score", value: "84%" },
  { label: "Cover letters ready", value: "2" },
  { label: "Applications sent", value: "1" },
];

export const NEW_MATCHES: JobMatch[] = [
  {
    id: "cedar-digital",
    title: "Junior Marketing Coordinator",
    company: "Cedar Digital",
    location: "Beirut / Hybrid",
    source: "Email apply",
    matchScore: 87,
    whyItMatches: [
      "Social media experience",
      "Canva/design projects",
      "English communication skills",
    ],
    missingSkills: ["Google Analytics", "Paid ads experience"],
    coverLetterPreview:
      "Dear Cedar Digital team, I’m excited to apply for the Junior Marketing Coordinator role. My experience with social media content, Canva design projects, and English communication makes this role a strong match...",
  },
  {
    id: "levant-labs",
    title: "Frontend Developer Intern",
    company: "Levant Labs",
    location: "Remote / Lebanon",
    source: "Company careers",
    matchScore: 82,
    whyItMatches: [
      "React project experience",
      "JavaScript fundamentals",
      "Portfolio website",
    ],
    missingSkills: ["TypeScript testing", "API integration experience"],
    coverLetterPreview:
      "Dear Levant Labs team, I’m interested in the Frontend Developer Intern role because it aligns with my React projects, JavaScript foundation, and interest in building user-friendly web apps...",
  },
  {
    id: "mena-cloud",
    title: "Customer Success Associate",
    company: "MENA Cloud",
    location: "Beirut / On-site",
    source: "LinkedIn manual",
    matchScore: 76,
    whyItMatches: [
      "Communication skills",
      "Problem-solving experience",
      "English and Arabic communication",
    ],
    missingSkills: ["CRM tools", "SaaS support experience"],
    coverLetterPreview:
      "Dear MENA Cloud team, I’m interested in the Customer Success Associate role because it matches my communication skills, problem-solving mindset, and ability to work with different types of users...",
  },
];

export const APPROVED_JOB = {
  title: "Marketing Assistant",
  company: "Bright Ads",
  status: "Ready to send after final confirmation",
};

export const SENT_APPLICATION = {
  title: "Content Intern",
  company: "Beirut Startup",
  status: "Sent",
  sentDate: "Today",
  method: "Email apply",
};

export const REJECTED_JOB = {
  title: "Sales Intern",
  company: "Retail Hub",
  reason: "Not aligned with target roles",
};

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
