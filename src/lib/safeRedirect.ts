// A safe redirect target must be a same-origin relative path — never an
// absolute URL and never a protocol-relative one. `"//evil.com"` and
// `"/\\evil.com"` both satisfy a plain `startsWith("/")` check but are
// treated by browsers/`new URL(...)` as pointing to a different origin,
// so a bare `startsWith("/")` guard is not enough to prevent an open
// redirect. Used everywhere a `next` value comes from a query string
// (user-controlled) before it's used as a redirect target.
export function isSafeRedirectPath(value: string | null | undefined): value is string {
  if (!value) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/\\")) return false;
  return true;
}
