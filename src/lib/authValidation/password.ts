// Shared password-policy constants for every surface that sets or changes a
// password (signup, reset-password) — single source of truth, kept in sync
// with supabase/config.toml's minimum_password_length (also 8) and
// password_requirements (left empty: no composition rules beyond length,
// since Supabase Auth enforces none either).
//
// MIN=8: no composition rules (uppercase/number/symbol) are required either,
// matching Supabase Auth's own policy exactly. MAX is generous (200) so a
// password-manager-generated value, a long passphrase, spaces, Unicode, or
// pasted input is never rejected or silently truncated — every call site
// validates the full string length and passes it through unmodified to
// Supabase Auth.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;
