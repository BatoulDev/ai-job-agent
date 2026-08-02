export interface DashboardTab {
  id: string;
  label: string;
}

export default function DashboardTabs({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: DashboardTab[];
  activeTab: string;
  onChange: (id: string) => void;
}) {
  return (
    <>
      <nav className="hidden w-56 shrink-0 lg:block">
        <ul className="space-y-1">
          {tabs.map((tab) => (
            <li key={tab.id}>
              <button
                type="button"
                onClick={() => onChange(tab.id)}
                className={`w-full rounded-xl px-4 py-2.5 text-left text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted hover:bg-white hover:text-text"
                }`}
              >
                {tab.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <nav className="-mx-6 overflow-x-auto px-6 pb-1 lg:hidden">
        <ul className="flex w-max gap-2">
          {tabs.map((tab) => (
            <li key={tab.id}>
              <button
                type="button"
                onClick={() => onChange(tab.id)}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-primary text-white"
                    : "border border-slate-200 bg-card text-muted hover:text-text"
                }`}
              >
                {tab.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
