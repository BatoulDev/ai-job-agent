export default function TrustNote({
  children,
  emphasized = false,
}: {
  children: React.ReactNode;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-sm leading-relaxed ${
        emphasized
          ? "border-primary/15 bg-primary/5 text-text"
          : "border-slate-200 bg-bg text-muted"
      }`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          emphasized ? "bg-primary/15 text-primary" : "bg-slate-200 text-muted"
        }`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <p>{children}</p>
    </div>
  );
}
