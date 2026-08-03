import Link from "next/link";

export interface PreferencesData {
  targetRoles: string | null;
  location: string | null;
  workArrangement: string | null;
  jobType: string | null;
  experienceLevel: string | null;
  additionalNotes: string | null;
}

const NOT_SET = "Not set yet";

export default function PreferencesSection({
  preferences,
}: {
  preferences: PreferencesData | null;
}) {
  const items = [
    { label: "Target roles", value: preferences?.targetRoles },
    { label: "Preferred location", value: preferences?.location },
    { label: "Work arrangement", value: preferences?.workArrangement },
    { label: "Job type", value: preferences?.jobType },
    { label: "Experience level", value: preferences?.experienceLevel },
  ];

  return (
    <div className="rounded-3xl border border-slate-200 bg-card p-6 shadow-sm sm:p-8">
      <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
              {item.label}
            </dt>
            <dd className="mt-1 text-sm text-text">{item.value || NOT_SET}</dd>
          </div>
        ))}

        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Extra details
          </dt>
          <dd className="mt-1 text-sm text-text">
            {preferences?.additionalNotes || NOT_SET}
          </dd>
        </div>
      </dl>

      <div className="mt-6 border-t border-slate-100 pt-6">
        <Link
          href="/onboarding/preferences"
          className="inline-block rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
        >
          Edit preferences
        </Link>
      </div>
    </div>
  );
}
