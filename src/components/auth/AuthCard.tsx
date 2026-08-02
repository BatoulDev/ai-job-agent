export default function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-text">
        {title}
      </h1>
      {description && (
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {description}
        </p>
      )}

      <div className="mt-8">{children}</div>

      {footer && <div className="mt-6">{footer}</div>}
    </div>
  );
}
