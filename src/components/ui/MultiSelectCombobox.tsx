"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  comboboxFieldClass,
  filterOptions,
  groupOptions,
  type ComboboxOption,
} from "./Combobox";

// Sentinel for the always-appended trailing "Other" row — never a real
// reference-table id, so it can't collide with an actual option value.
const OTHER_SENTINEL = "__other__";

function normalizeEntry(value: string): string {
  return value.trim();
}

// Multi-select searchable combobox with removable chips — the multi-value
// sibling of Combobox.tsx, reused for target roles and preferred
// locations. Already-selected options are excluded from the open
// dropdown (they're shown as chips instead), and selection stops being
// offered once maxSelections (combined predefined + custom count) is
// reached.
//
// Custom entries: an "Other" row is always appended last in the dropdown.
// Selecting it switches the SAME input into custom-entry mode (no second
// field/Add button) — typing updates a local draft, Enter commits it into
// customValues as a chip identical in style to a predefined selection,
// then the input returns to its normal searchable state. Escape or
// Backspace-on-empty-draft cancels custom entry without adding anything.
export default function MultiSelectCombobox({
  id,
  label,
  options,
  selectedValues,
  onChange,
  customValues,
  onCustomValuesChange,
  maxSelections,
  placeholder = "Search...",
  otherLabel = "Other",
  customPlaceholder = "Type and press Enter",
  helperText,
  disabled = false,
  emptyMessage = "No matches found.",
}: {
  id: string;
  label: string;
  options: ComboboxOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  customValues: string[];
  onCustomValuesChange: (values: string[]) => void;
  maxSelections?: number;
  placeholder?: string;
  otherLabel?: string;
  customPlaceholder?: string;
  helperText?: string;
  disabled?: boolean;
  emptyMessage?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isCustomEntryMode, setIsCustomEntryMode] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const [customEntryError, setCustomEntryError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selectedOptions = useMemo(
    () => selectedValues.map((v) => options.find((o) => o.value === v)).filter((o): o is ComboboxOption => !!o),
    [options, selectedValues]
  );

  const total = selectedValues.length + customValues.length;
  const atMax = maxSelections !== undefined && total >= maxSelections;

  const selectableOptions = useMemo(
    () => options.filter((option) => !selectedValues.includes(option.value)),
    [options, selectedValues]
  );

  const filtered = useMemo(() => {
    const base = filterOptions(selectableOptions, query);
    if (atMax) return base;
    return [...base, { value: OTHER_SENTINEL, label: otherLabel }];
  }, [selectableOptions, query, atMax, otherLabel]);
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

  function addOption(option: ComboboxOption) {
    if (atMax) return;
    if (option.value === OTHER_SENTINEL) {
      setIsCustomEntryMode(true);
      setCustomDraft("");
      setCustomEntryError(null);
      setIsOpen(false);
      setQuery("");
      return;
    }
    onChange([...selectedValues, option.value]);
    setQuery("");
    setActiveIndex(0);
  }

  // Shared by onFocus and onClick: a click on an input that already has
  // DOM focus never refires a "focus" event, so relying on onFocus alone
  // would leave the dropdown stuck closed after certain transitions
  // (e.g. right after Escape, or before the reopen-on-commit below).
  function openDropdown() {
    if (isCustomEntryMode) return;
    setIsOpen(true);
    setActiveIndex(0);
  }

  function removeValue(value: string) {
    onChange(selectedValues.filter((v) => v !== value));
  }

  function removeCustomValue(value: string) {
    onCustomValuesChange(customValues.filter((v) => v !== value));
  }

  function commitCustomDraft() {
    const trimmed = normalizeEntry(customDraft);
    if (!trimmed) return;
    if (atMax) {
      setCustomEntryError(`Maximum of ${maxSelections} reached.`);
      return;
    }
    const key = trimmed.toLowerCase();
    const isDuplicate =
      customValues.some((v) => v.toLowerCase() === key) ||
      selectedOptions.some((o) => o.label.toLowerCase() === key);
    if (isDuplicate) {
      setCustomEntryError("Already added.");
      return;
    }
    onCustomValuesChange([...customValues, trimmed]);
    setCustomDraft("");
    setCustomEntryError(null);
    setIsCustomEntryMode(false);
    // Reopen the normal searchable list immediately — mirrors what
    // already happens after picking a predefined option (the dropdown
    // was already open, so it just stays open for the next pick). The
    // input keeps DOM focus throughout, so without this the dropdown
    // would otherwise only reappear on the next keystroke, not on a
    // second click (a redundant click on an already-focused input never
    // refires the "focus" event).
    setIsOpen(true);
    setActiveIndex(0);
  }

  function exitCustomEntry() {
    setIsCustomEntryMode(false);
    setCustomDraft("");
    setCustomEntryError(null);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (isCustomEntryMode) {
      if (event.key === "Enter") {
        event.preventDefault();
        commitCustomDraft();
      } else if (event.key === "Escape") {
        event.preventDefault();
        exitCustomEntry();
      } else if (event.key === "Backspace" && customDraft === "") {
        exitCustomEntry();
      }
      return;
    }

    if (event.key === "Backspace" && query === "") {
      if (selectedValues.length > 0) {
        removeValue(selectedValues[selectedValues.length - 1]);
      } else if (customValues.length > 0) {
        removeCustomValue(customValues[customValues.length - 1]);
      }
      return;
    }

    if (!isOpen && event.key === "ArrowDown") {
      setIsOpen(true);
      return;
    }

    if (!isOpen) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) addOption(option);
    } else if (event.key === "Escape") {
      setIsOpen(false);
      setQuery("");
    }
  }

  const activeOption = filtered[activeIndex];
  const chips = [
    ...selectedOptions.map((o) => ({ key: o.value, label: o.label, onRemove: () => removeValue(o.value) })),
    ...customValues.map((v) => ({ key: v, label: v, onRemove: () => removeCustomValue(v) })),
  ];

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-text">
        {label}
      </label>

      {chips.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li
              key={chip.key}
              className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
            >
              {chip.label}
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove ${chip.label}`}
                disabled={disabled}
                className="text-primary/70 hover:text-primary"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        id={id}
        role="combobox"
        aria-expanded={isCustomEntryMode ? false : isOpen}
        aria-controls={listboxId}
        aria-activedescendant={
          !isCustomEntryMode && activeOption ? `${listboxId}-${activeOption.value}` : undefined
        }
        aria-autocomplete="list"
        autoComplete="off"
        type="text"
        placeholder={atMax ? "Maximum reached" : isCustomEntryMode ? customPlaceholder : placeholder}
        disabled={disabled || (atMax && !isCustomEntryMode)}
        value={isCustomEntryMode ? customDraft : query}
        onFocus={openDropdown}
        onClick={openDropdown}
        onChange={(event) => {
          if (isCustomEntryMode) {
            setCustomDraft(event.target.value);
            setCustomEntryError(null);
            return;
          }
          setQuery(event.target.value);
          setIsOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
        className={comboboxFieldClass}
      />

      {isOpen && !isCustomEntryMode && (
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
                  return (
                    <li
                      key={option.value}
                      id={`${listboxId}-${option.value}`}
                      role="option"
                      aria-selected={false}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        addOption(option);
                      }}
                      onMouseEnter={() => setActiveIndex(flatIndex)}
                      className={`cursor-pointer px-4 py-2 text-sm ${
                        isActive ? "bg-primary/10 text-primary" : "text-text"
                      }`}
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

      {customEntryError ? (
        <p className="mt-1.5 text-xs leading-relaxed text-red-600">{customEntryError}</p>
      ) : atMax ? (
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          Maximum of {maxSelections} reached — remove one to add another.
        </p>
      ) : (
        helperText && <p className="mt-1.5 text-xs leading-relaxed text-muted">{helperText}</p>
      )}
    </div>
  );
}
