// Shared password-policy constants and composition rules for every surface
// that SETS or CHANGES a password (signup, reset-password, update-password
// API) — single source of truth, kept in sync with supabase/config.toml's
// minimum_password_length (8). GoTrue's own built-in password_requirements
// setting only offers letters_digits / lower_upper_letters_digits /
// lower_upper_letters_digits_symbols — none of which matches "uppercase +
// special required, lowercase/digit optional" without also over-requiring a
// lowercase letter and a digit. So password_requirements is left unset
// (composition is enforced at the app layer only, both client and API —
// see that file's comment) rather than picking an over-strict built-in
// option that would reject a password this policy considers valid.
//
// Policy: minimum length, at least one uppercase letter, at least one
// special character. Deliberately does NOT require a lowercase letter or a
// number — every other character in the password may be anything.
//
// Login is deliberately NOT a consumer of isPasswordCompositionValid or
// getPasswordValidationError — an existing account may have set its
// password before this composition policy existed (or under a different
// one), and login must keep accepting it (see src/app/api/auth/login/
// route.ts's parseBody, which only ever imports MAX_PASSWORD_LENGTH as a
// cheap upper-bound sanity check before calling signInWithPassword — never
// a composition re-check).
//
// MAX = 72 — empirically confirmed against real local GoTrue (Supabase
// Auth), not an arbitrary choice: signUp() accepts a 72-character password
// and rejects a 73-character one with "Password cannot be longer than 72
// characters" (a bcrypt limitation GoTrue enforces server-side regardless of
// minimum_password_length/password_requirements — see
// tests/db/auth-credential-policy.test.mjs's boundary tests). A password
// longer than this is REJECTED, never silently truncated — every call site
// validates the full string length up front and never slices it before
// passing it to Supabase Auth. Unicode characters and spaces count as-is
// (JS string length, i.e. UTF-16 code units) and are never rejected,
// stripped, or normalized beyond this length check.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;

// Compact, single-line UI hint shown below the password field on Signup and
// Reset Password — the one place this exact copy is written, so the visible
// hint can never drift from what's actually enforced below. Deliberately
// never mentions the 72-character maximum: that detail only matters to the
// rare user who exceeds it, so it's surfaced only in the field-level error
// via getPasswordValidationError below, not in this always-visible hint.
export const PASSWORD_HINT =
  "8+ characters, including 1 uppercase letter and 1 special character.";

// Deliberately broad — not limited to a small "safe" subset like #, $, % —
// so common punctuation/symbol keys are all accepted as a qualifying
// special character.
const SPECIAL_CHARACTER_REGEX = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;

export type PasswordRequirementId = "length" | "uppercase" | "special";

export interface PasswordRequirement {
  id: PasswordRequirementId;
  label: string;
  test: (password: string) => boolean;
}

// Single source of truth for server-side composition validation below —
// exactly the two composition rules PASSWORD_HINT describes, plus length.
export const PASSWORD_REQUIREMENTS: readonly PasswordRequirement[] = [
  {
    id: "length",
    label: `At least ${MIN_PASSWORD_LENGTH} characters`,
    test: (password) => password.length >= MIN_PASSWORD_LENGTH,
  },
  {
    id: "uppercase",
    label: "One uppercase letter",
    test: (password) => /[A-Z]/.test(password),
  },
  {
    id: "special",
    label: "One special character",
    test: (password) => SPECIAL_CHARACTER_REGEX.test(password),
  },
];

// Returns the ids of every requirement the password does NOT currently
// satisfy — empty when fully valid.
export function getUnmetPasswordRequirements(password: string): PasswordRequirementId[] {
  return PASSWORD_REQUIREMENTS.filter((requirement) => !requirement.test(password)).map(
    (requirement) => requirement.id
  );
}

// The one function every "set/change a password" surface (signup frontend +
// API, reset-password frontend, update-password API) must gate on before
// accepting a password — length (both bounds), both composition rules. A
// missing lowercase letter or number never fails this check.
export function isPasswordCompositionValid(password: string): boolean {
  return (
    password.length <= MAX_PASSWORD_LENGTH &&
    getUnmetPasswordRequirements(password).length === 0
  );
}

// Field-level error copy. Two distinct messages, never combined into one
// generic string: the 72-character maximum is only ever mentioned when the
// user has actually exceeded it (matching PASSWORD_HINT above, which never
// mentions it) — every other invalid case (too short and/or missing a
// required character class) gets the composition message instead, even if
// the password also happens to be short.
export const PASSWORD_TOO_LONG_ERROR = `Password must be no more than ${MAX_PASSWORD_LENGTH} characters.`;
export const PASSWORD_COMPOSITION_ERROR = `Password must be at least ${MIN_PASSWORD_LENGTH} characters and include an uppercase letter and a special character.`;

// Single source of truth for the field-level validation message shown by
// Signup, Reset Password, and both API routes (signup, update-password) —
// returns null when the password is fully valid.
export function getPasswordValidationError(password: string): string | null {
  if (password.length > MAX_PASSWORD_LENGTH) return PASSWORD_TOO_LONG_ERROR;
  if (getUnmetPasswordRequirements(password).length > 0) return PASSWORD_COMPOSITION_ERROR;
  return null;
}
