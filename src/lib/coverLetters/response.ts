// Runtime validation for the LLM cover-letter draft response (Phase 08).
// Pure, no network. AGENTS.md §30: "Validate structured AI output against an
// explicit runtime schema before storing or using it" — a cover letter is
// free text, not JSON, but it still gets a real check: non-empty, within
// sane length bounds, and not an obvious refusal/error string standing in
// for real content.

const MIN_LENGTH = 100;
const MAX_LENGTH = 4000;

export type ParseCoverLetterResponseResult = { ok: true; value: string } | { ok: false; error: string };

/** Accepts either a raw string (typical chat-completion content) or an object with a `content` string field. */
export function parseCoverLetterResponse(raw: unknown): ParseCoverLetterResponseResult {
  let text: unknown = raw;
  if (typeof raw === "object" && raw !== null && "content" in raw) {
    text = (raw as Record<string, unknown>).content;
  }

  if (typeof text !== "string") {
    return { ok: false, error: "Response must be a string" };
  }

  const trimmed = text.trim();
  if (trimmed.length < MIN_LENGTH) {
    return { ok: false, error: `Response is too short to be a real cover letter (min ${MIN_LENGTH} characters)` };
  }
  if (trimmed.length > MAX_LENGTH) {
    return { ok: false, error: `Response is too long (max ${MAX_LENGTH} characters)` };
  }

  return { ok: true, value: trimmed };
}
