"use client";

import { useState } from "react";
import Link from "next/link";
import type { CvAnalysis } from "@/lib/cvAnalysis/types";
import type { CvProfileState, RequestChangesPayload } from "@/lib/cvAnalysis/profileState";
import type { PreferencesData } from "@/components/dashboard/PreferencesSection";
import ApproveProfileDialog from "./ApproveProfileDialog";
import RequestChangesDialog from "./RequestChangesDialog";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function TagList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted">Not available yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex max-w-full items-center break-words rounded-full bg-bg px-3 py-1 text-xs font-medium text-text"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted">Not available yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm text-text">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <span className="break-words">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function FactBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function CvInformationGroup({ analysis }: { analysis: CvAnalysis }) {
  return (
    <div className="space-y-6">
      <h3 className="font-display text-base font-semibold text-text">CV Information</h3>
      <FactBlock label="Professional Summary">
        <p className="text-sm leading-relaxed text-text">
          {analysis.professional_summary || "Not available yet."}
        </p>
      </FactBlock>
      <FactBlock label="Skills">
        <TagList items={analysis.skills} />
      </FactBlock>
      <FactBlock label="Education">
        {analysis.education.length === 0 ? (
          <p className="text-sm text-muted">Not available yet.</p>
        ) : (
          <ul className="space-y-3">
            {analysis.education.map((entry, index) => (
              <li key={index} className="text-sm text-text">
                <p className="font-medium">{entry.degree || "Degree"}{entry.field_of_study ? ` · ${entry.field_of_study}` : ""}</p>
                <p className="text-muted">{entry.institution}</p>
              </li>
            ))}
          </ul>
        )}
      </FactBlock>
      <FactBlock label="Work Experience">
        {analysis.work_experience.length === 0 ? (
          <p className="text-sm text-muted">Not available yet.</p>
        ) : (
          <ul className="space-y-4">
            {analysis.work_experience.map((entry, index) => (
              <li key={index} className="text-sm text-text">
                <p className="font-medium">{entry.title} · {entry.organization}</p>
                {entry.highlights && entry.highlights.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {entry.highlights.map((highlight, i) => (
                      <li key={i} className="text-muted">— {highlight}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </FactBlock>
      <FactBlock label="Projects">
        {analysis.projects.length === 0 ? (
          <p className="text-sm text-muted">Not available yet.</p>
        ) : (
          <ul className="space-y-2">
            {analysis.projects.map((entry, index) => (
              <li key={index} className="text-sm text-text">
                <span className="font-medium">{entry.name}</span>
                {entry.description ? ` — ${entry.description}` : ""}
              </li>
            ))}
          </ul>
        )}
      </FactBlock>
      {analysis.certifications.length > 0 && (
        <FactBlock label="Certifications">
          <BulletList items={analysis.certifications.map((c) => c.name)} />
        </FactBlock>
      )}
      <FactBlock label="Languages">
        {analysis.languages.length === 0 ? (
          <p className="text-sm text-muted">Not available yet.</p>
        ) : (
          <TagList
            items={analysis.languages.map((l) =>
              l.proficiency ? `${l.language} (${l.proficiency})` : l.language
            )}
          />
        )}
      </FactBlock>
    </div>
  );
}

// Compact preference context (Item 5): a single line, not the full field
// grid — the dedicated Preferences tab is the one place that shows and
// edits every field. Reflects the user's LIVE current preferences (not
// the historical preference_snapshot baked into the analysis) — that's
// the whole point of being able to notice they've diverged (Item 8).
function firstToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}

function titleCase(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("-");
}

function CompactPreferenceContext({
  preferences,
  onNavigateToPreferences,
}: {
  preferences: PreferencesData;
  onNavigateToPreferences: () => void;
}) {
  const tokens = [
    firstToken(preferences.targetRoles),
    titleCase(preferences.remotePreference),
    titleCase(preferences.experienceLevel),
  ].filter((token): token is string => !!token);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl bg-bg px-4 py-3">
      <p className="min-w-0 truncate text-sm text-text">
        {tokens.length > 0 ? (
          <>
            <span className="text-muted">Based on your current preferences:</span>{" "}
            <span className="font-medium">{tokens.join(" · ")}</span>
          </>
        ) : (
          <span className="text-muted">Your career preferences aren&apos;t set yet.</span>
        )}
      </p>
      <button
        type="button"
        onClick={onNavigateToPreferences}
        className="shrink-0 text-sm font-medium text-primary hover:text-primary-dark"
      >
        View/Edit preferences
      </button>
    </div>
  );
}

function AiRecommendationsGroup({ analysis }: { analysis: CvAnalysis }) {
  return (
    <div className="space-y-6">
      <h3 className="font-display text-base font-semibold text-text">AI Recommendations</h3>
      <FactBlock label="Recommended Roles">
        <TagList items={analysis.recommended_roles} />
      </FactBlock>
      <FactBlock label="Profile Level">
        <p className="text-sm text-text">{analysis.profile_level || "Not available yet."}</p>
      </FactBlock>
      <FactBlock label="Strongest Areas">
        <TagList items={analysis.strongest_areas} />
      </FactBlock>
      <FactBlock label="Career Recommendations">
        <BulletList items={analysis.career_recommendations} />
      </FactBlock>
      <FactBlock label="Search Focus">
        <TagList items={analysis.search_focus} />
      </FactBlock>
      {analysis.development_areas.length > 0 && (
        <FactBlock label="Development Areas">
          <BulletList items={analysis.development_areas} />
        </FactBlock>
      )}
    </div>
  );
}

export default function AiCareerProfileSection({
  state,
  analysis,
  preferences,
  onApprove,
  onRequestChanges,
  onNavigateToPreferences,
}: {
  state: CvProfileState;
  analysis: CvAnalysis | null;
  preferences: PreferencesData | null;
  onApprove: () => Promise<{ ok: boolean; message?: string }>;
  onRequestChanges: (payload: RequestChangesPayload) => Promise<{ ok: boolean; message?: string }>;
  onNavigateToPreferences: () => void;
}) {
  const [showApprove, setShowApprove] = useState(false);
  const [showRequestChanges, setShowRequestChanges] = useState(false);

  const showFullContent =
    analysis &&
    (state === "ready_for_review" ||
      state === "approved" ||
      state === "preferences_outdated" ||
      state === "changes_requested");

  return (
    <section className="rounded-3xl border border-slate-200 bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold text-text">AI Career Profile</h2>
        {state === "ready_for_review" && (
          <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            Ready for review
          </span>
        )}
        {state === "approved" && (
          <span className="inline-flex items-center rounded-full bg-success/10 px-3 py-1 text-xs font-semibold text-success">
            Approved
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Combines your verified CV facts with your current career
        preferences to recommend roles and next steps.
      </p>

      {preferences && state !== "no_cv" && state !== "no_preferences" && (
        <div className="mt-5">
          <CompactPreferenceContext
            preferences={preferences}
            onNavigateToPreferences={onNavigateToPreferences}
          />
        </div>
      )}

      <div className="mt-8">
        {state === "no_cv" && (
          <EmptyStateBlock
            message="Upload your CV to create your AI Career Profile."
            actionLabel="Upload CV"
            actionHref="/onboarding/upload-cv"
          />
        )}

        {state === "no_preferences" && (
          <EmptyStateBlock
            message="Complete your career preferences to start your profile analysis."
            actionLabel="Complete Preferences"
            actionHref="/onboarding/preferences"
          />
        )}

        {state === "analyzing" && (
          <ProgressBlock message="We're analyzing your CV and career preferences." />
        )}

        {state === "changes_requested" && (
          <>
            <ProgressBlock message="We're updating your profile based on your feedback." />
            {showFullContent && analysis && (
              <div className="mt-8 border-t border-slate-100 pt-8">
                <ProfileContent analysis={analysis} />
              </div>
            )}
          </>
        )}

        {state === "failed" && (
          <FailedBlock hasRetryEndpoint={false} />
        )}

        {showFullContent && analysis && state !== "changes_requested" && (
          <>
            {state === "preferences_outdated" && (
              <div className="mb-8 flex items-start gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-5 py-4 text-sm leading-relaxed text-amber-800">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0">
                  <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div>
                  <p className="font-semibold">Your AI recommendations are outdated</p>
                  <p className="mt-1">
                    Your preferences changed after this profile was
                    generated. We&apos;ll refresh your AI recommendations to
                    match — the CV information below is still accurate and
                    doesn&apos;t need to be reparsed.
                  </p>
                  <button
                    type="button"
                    onClick={onNavigateToPreferences}
                    className="mt-2 font-semibold text-amber-900 underline hover:text-amber-950"
                  >
                    Review your preferences to refresh sooner
                  </button>
                </div>
              </div>
            )}

            {state === "approved" && analysis.approved_at && (
              <div className="mb-8 flex items-start gap-3 rounded-2xl border border-success/20 bg-success/5 px-4 py-3.5 text-sm leading-relaxed text-text">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" className="mt-0.5 shrink-0">
                  <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p>
                  Your career profile is approved and ready for job
                  matching. Approved {formatDate(analysis.approved_at)}.
                </p>
              </div>
            )}

            <ProfileContent analysis={analysis} />

            {state === "ready_for_review" && (
              <div className="mt-8 flex flex-col gap-3 border-t border-slate-100 pt-8 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setShowApprove(true)}
                  className="flex-1 rounded-full bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
                >
                  Approve Profile
                </button>
                <button
                  type="button"
                  onClick={() => setShowRequestChanges(true)}
                  className="flex-1 rounded-full border border-slate-200 py-2.5 text-sm font-semibold text-text transition-colors hover:border-slate-300"
                >
                  Request Changes
                </button>
              </div>
            )}

            {state === "preferences_outdated" && (
              <div className="mt-8 border-t border-slate-100 pt-8">
                <p className="text-xs text-muted">
                  Outdated recommendations can&apos;t be approved until
                  they&apos;re refreshed against your current preferences.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {analysis && (
        <>
          <ApproveProfileDialog
            open={showApprove}
            onClose={() => setShowApprove(false)}
            onConfirm={onApprove}
          />
          <RequestChangesDialog
            open={showRequestChanges}
            onClose={() => setShowRequestChanges(false)}
            analysisId={analysis.id}
            onSubmit={onRequestChanges}
          />
        </>
      )}
    </section>
  );
}

function ProfileContent({ analysis }: { analysis: CvAnalysis }) {
  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
      <CvInformationGroup analysis={analysis} />
      <AiRecommendationsGroup analysis={analysis} />
    </div>
  );
}

function EmptyStateBlock({
  message,
  actionLabel,
  actionHref,
}: {
  message: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-bg px-6 py-10 text-center">
      <p className="text-sm text-muted">{message}</p>
      <Link
        href={actionHref}
        className="mt-4 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
      >
        {actionLabel}
      </Link>
    </div>
  );
}

function ProgressBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-bg px-6 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
        <svg
          className="h-5 w-5 animate-spin text-accent"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
        </svg>
      </span>
      <p className="max-w-sm text-sm leading-relaxed text-text">{message}</p>
      <p className="max-w-sm text-xs leading-relaxed text-muted">
        Your result will appear on this page automatically when it&apos;s
        ready — no need to refresh.
      </p>
    </div>
  );
}

function FailedBlock({ hasRetryEndpoint }: { hasRetryEndpoint: boolean }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-10 text-center">
      <p className="text-sm font-medium text-red-700">
        We couldn&apos;t complete your profile analysis.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-red-700/80">
        This sometimes happens with unusual file formats or a temporary
        issue on our side.
      </p>
      {hasRetryEndpoint ? (
        <button
          type="button"
          className="mt-4 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
        >
          Try Again
        </button>
      ) : (
        <p className="mt-4 text-xs text-red-700/70">
          A retry option isn&apos;t available yet — please check back
          soon, or replace your CV to start a new analysis.
        </p>
      )}
    </div>
  );
}
