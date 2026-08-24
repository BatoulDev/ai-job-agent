// A safe redirect target must be a same-origin relative path — never an
// absolute URL and never a protocol-relative one. `"//evil.com"` and
// `"/\\evil.com"` both satisfy a plain `startsWith("/")` check but are
// treated by browsers/`new URL(...)` as pointing to a different origin,
// so a bare `startsWith("/")` guard is not enough to prevent an open
// redirect. Used everywhere a `next` value comes from a query string
// (user-controlled) before it's used as a redirect target.
//
// ASCII control characters (codes 0-31, the C0 range, plus DEL at 127) must
// be rejected before the prefix checks below: the WHATWG URL parser strips
// tab/CR/LF during preprocessing, so a value like a tab character followed
// by "/evil.com" satisfies every prefix check here yet collapses to
// "//evil.com" — and therefore a different origin — once passed through
// `new URL(next, origin)`. Confirmed via tests/unit/safe-redirect.test.mjs,
// which resolves every accepted value through that exact
// `new URL(next, origin)` call and asserts the origin never changes.
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function isSafeRedirectPath(value: string | null | undefined): value is string {
  if (!value) return false;
  if (hasControlCharacter(value)) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/\\")) return false;
  return true;
}
