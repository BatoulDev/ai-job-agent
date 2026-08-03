"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface ComboboxOption {
  value: string;
  label: string;
  sublabel?: string;
  group?: string;
}

export const comboboxFieldClass =
  "w-full rounded-xl border border-slate-200 bg-bg px-4 py-2.5 text-sm text-text placeholder:text-muted/60 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";
const fieldClass = comboboxFieldClass;

export function filterOptions(options: ComboboxOption[], query: string): ComboboxOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(q) ||
      option.sublabel?.toLowerCase().includes(q)
  );
}

// Groups options by their `group` field, preserving each group's first
// appearance order (options are expected to already be sorted by category
// then name, so no group is ever split across two ranges).
export function groupOptions(options: ComboboxOption[]): { group: string | null; options: ComboboxOption[] }[] {
  const groups: { group: string | null; options: ComboboxOption[] }[] = [];
  for (const option of options) {
    const key = option.group ?? null;
    const last = groups[groups.length - 1];
    if (last && last.group === key) {
      last.options.push(option);
    } else {
      groups.push({ group: key, options: [option] });
    }
  }
  return groups;
}

// Single-select searchable combobox — built from plain React + Tailwind
// (no combobox/autocomplete library is installed in this project, and
// AGENTS.md directs against adding one when the existing stack can solve
// the problem safely). Follows the ARIA combobox/listbox pattern with
// full keyboard support.
//
// Optional "Other" custom-entry mode: when `otherValue` is supplied and
// `value === otherValue`, the SAME input switches to a plain text field
// bound to `customValue`/`onCustomValueChange` instead of the searchable
// dropdown — no second field is rendered below. A small "Choose from
// list" affordance reopens the normal dropdown (still logically on
// `otherValue` until a different option is actually picked), so a typed
// custom value survives browsing away and back. Omitting `otherValue`
// keeps this identical to a plain single-select combobox (e.g. Country).
export default function Combobox({
  id,
  label,
  options,
  value,
  onChange,
  placeholder = "Search...",
  helperText,
  required = false,
  disabled = false,
  emptyMessage = "No matches found.",
  otherValue,
  customValue = "",
  onCustomValueChange,
  customPlaceholder,
}: {
  id: string;
  label: string;
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  required?: boolean;
  disabled?: boolean;
  emptyMessage?: string;
  otherValue?: string;
  customValue?: string;
  onCustomValueChange?: (value: string) => void;
  customPlaceholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const isCustomMode = otherValue !== undefined && value === otherValue;

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  );

  // "Other" (when present) stays reachable at the end of the list even
  // when the typed query filters out every predefined option — otherwise
  // typing a genuinely new value (the exact scenario "Other" exists for)
  // would hit a dead-end "No matches found" with no way to reach it.
  const filtered = useMemo(() => {
    const base = filterOptions(options, query);
    if (otherValue === undefined || base.some((o) => o.value === otherValue)) return base;
    const otherOption = options.find((o) => o.value === otherValue);
    return otherOption ? [...base, otherOption] : base;
  }, [options, query, otherValue]);
  const grouped = useMemo(() => groupOptions(filtered), [filtered]);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setQuery("");
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  function selectOption(option: ComboboxOption) {
    onChange(option.value);
    setQuery("");
    setIsOpen(false);
  }

  function handleFocus() {
    if (isCustomMode) {
      // Plain text editing — no dropdown while typing a custom value.
      setActiveIndex(0);
      return;
    }
    setIsOpen(true);
    setActiveIndex(0);
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (!isOpen && isCustomMode) {
      onCustomValueChange?.(event.target.value);
      return;
    }
    setQuery(event.target.value);
    setIsOpen(true);
    setActiveIndex(0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen && isCustomMode) {
      // Enter/Tab "confirm" the already-live custom value; Escape backs
      // out to the predefined list without discarding what was typed.
      if (event.key === "Enter") {
        event.preventDefault();
        event.currentTarget.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        onChange("");
        setIsOpen(false);
        setQuery("");
      }
      return;
    }

    if (!isOpen) {
      if (event.key === "Enter") {
        event.preventDefault();
        setIsOpen(true);
      } else if (event.key === "ArrowDown") {
        setIsOpen(true);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) selectOption(option);
    } else if (event.key === "Escape") {
      setIsOpen(false);
      setQuery("");
    }
  }

  const activeOption = filtered[activeIndex];
  const displayValue = isOpen ? query : isCustomMode ? customValue : selectedOption?.label ?? "";
  const placeholderText = isOpen
    ? placeholder
    : isCustomMode
      ? customPlaceholder ?? placeholder
      : selectedOption
        ? selectedOption.label
        : placeholder;
  const showBrowseButton = isCustomMode && !isOpen && !disabled;

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-text">
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeOption ? `${listboxId}-${activeOption.value}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          type="text"
          placeholder={placeholderText}
          required={required}
          disabled={disabled}
          value={displayValue}
          onFocus={handleFocus}
          onClick={handleFocus}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={`${fieldClass} ${showBrowseButton ? "pr-32" : ""}`}
        />
        {showBrowseButton && (
          <button
            type="button"
            onClick={() => {
              setIsOpen(true);
              setQuery("");
              setActiveIndex(0);
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
          >
            Choose from list
          </button>
        )}
      </div>

      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {filtered.length === 0 && (
            <li className="px-4 py-2.5 text-sm text-muted">{emptyMessage}</li>
          )}
          {grouped.map((section, sectionIndex) => (
            <li key={section.group ?? `ungrouped-${sectionIndex}`}>
              {section.group && (
                <p className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  {section.group}
                </p>
              )}
              <ul>
                {section.options.map((option) => {
                  const flatIndex = filtered.indexOf(option);
                  const isActive = flatIndex === activeIndex;
                  const isSelected = option.value === value;
                  return (
                    <li
                      key={option.value}
                      id={`${listboxId}-${option.value}`}
                      role="option"
                      aria-selected={isSelected}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        selectOption(option);
                      }}
                      onMouseEnter={() => setActiveIndex(flatIndex)}
                      className={`cursor-pointer px-4 py-2 text-sm ${
                        isActive ? "bg-primary/10 text-primary" : "text-text"
                      } ${isSelected ? "font-semibold" : ""}`}
                    >
                      {option.label}
                      {option.sublabel && (
                        <span className="ml-1.5 text-xs text-muted">{option.sublabel}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {helperText && <p className="mt-1.5 text-xs leading-relaxed text-muted">{helperText}</p>}
    </div>
  );
}
