// Shared email trim/normalize/validate logic for every email/password auth
// surface (signup, login, forgot-password) — a single source of truth so
// the three routes and their pages cannot drift from each other.
//
// Deliberately provider-agnostic: never Gmail-only or domain-specific
// (no dot-stripping, no canonicalizing "+tag" suffixes the way Gmail's own
// inbox does internally) — a "+tag" address is always treated as its own
// distinct address, exactly what the user typed, only trimmed and
// case-folded. No external dependency: a full RFC 5322 parser is far more
// than this app needs and would risk rejecting real addresses; this format
// check only guards against the malformed shapes that matter in practice
// (missing "@", missing local part, missing domain, embedded whitespace).

export const MAX_EMAIL_LENGTH = 320;

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Trim + lowercase — applied before validation, before hashing for rate
// limiting, and before every call into Supabase Auth, so the same address
// typed with different casing or incidental whitespace is always treated
// as the same account.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Format-only check (not a mailbox-existence check — Supabase Auth itself
// is the source of truth for whether an address is deliverable/registered).
// Accepts plus-addressing (name+tag@example.com) and any domain; rejects
// missing local part, missing domain, missing "@", and embedded whitespace.
export function isValidEmailFormat(email: string): boolean {
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_FORMAT_REGEX.test(email);
}
