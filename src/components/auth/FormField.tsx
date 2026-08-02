const fieldClass =
  "w-full rounded-xl border border-slate-200 bg-bg px-4 py-2.5 text-sm text-text placeholder:text-muted/60 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

export default function FormField({
  id,
  label,
  type = "text",
  placeholder,
  autoComplete,
  required = true,
  options,
  helperText,
  rows = 4,
  defaultValue,
}: {
  id: string;
  label: string;
  type?: "text" | "email" | "password" | "select" | "textarea";
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  helperText?: string;
  rows?: number;
  defaultValue?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-text"
      >
        {label}
      </label>

      {type === "select" ? (
        <select
          id={id}
          name={id}
          required={required}
          defaultValue={defaultValue ?? ""}
          className={fieldClass}
        >
          <option value="" disabled>
            Select an option
          </option>
          {options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : type === "textarea" ? (
        <textarea
          id={id}
          name={id}
          placeholder={placeholder}
          required={required}
          rows={rows}
          defaultValue={defaultValue}
          className={`${fieldClass} resize-none`}
        />
      ) : (
        <input
          id={id}
          name={id}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          defaultValue={defaultValue}
          className={fieldClass}
        />
      )}

      {helperText && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          {helperText}
        </p>
      )}
    </div>
  );
}
