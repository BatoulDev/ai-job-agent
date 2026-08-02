import Link from "next/link";
import TrustNote from "./TrustNote";

export interface CvProfileData {
  fullName: string | null;
  university: string | null;
  major: string | null;
}

export interface CvFileData {
  fileName: string;
  status: string;
  createdAt: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function CvProfileSection({
  profile,
  cv,
  fallbackName,
}: {
  profile: CvProfileData | null;
  cv: CvFileData | null;
  fallbackName: string;
}) {
  const displayName = profile?.fullName || fallbackName;
  const subtitle = [profile?.major, profile?.university].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-card p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {getInitials(displayName)}
          </span>
          <div>
            <h3 className="font-display text-lg font-semibold text-text">
              {displayName}
            </h3>
            <p className="text-sm text-muted">
              {subtitle || "Add your university and major from Preferences."}
            </p>
          </div>
        </div>

        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            CV on file
          </p>
          {cv ? (
            <p className="mt-2 text-sm text-text">
              {cv.fileName} · {cv.status} ·{" "}
              {new Date(cv.createdAt).toLocaleDateString()}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">
              No CV uploaded yet.{" "}
              <Link
                href="/onboarding/upload-cv"
                className="font-medium text-primary hover:text-primary-dark"
              >
                Upload one
              </Link>
              .
            </p>
          )}
        </div>
      </div>

      <TrustNote>
        Skills, languages, and target roles will appear here once AI CV
        parsing is available.
      </TrustNote>
    </div>
  );
}
