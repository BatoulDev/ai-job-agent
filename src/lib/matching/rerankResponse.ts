// Runtime schema validation for the LLM rerank response (Phase 06). Pure,
// no network. AGENTS.md §30: "Validate structured AI output against an
// explicit runtime schema before storing or using it" — a malformed or
// incomplete response is rejected outright, never coerced or defaulted
// into a fabricated shape.

export interface RerankResult {
  score: number;
  reason: string;
  strengths: string[];
  missingSkills: string[];
  preferenceAlignment: string;
}

export type ParseRerankResponseResult = { ok: true; value: RerankResult } | { ok: false; error: string };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Parses and validates the JSON object an LLM was instructed to return (see RERANK_RESPONSE_SCHEMA_DESCRIPTION). */
export function parseRerankResponse(raw: unknown): ParseRerankResponseResult {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Response is not valid JSON" };
    }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "Response must be a JSON object" };
  }
  const record = parsed as Record<string, unknown>;

  if (typeof record.score !== "number" || !Number.isInteger(record.score) || record.score < 0 || record.score > 100) {
    return { ok: false, error: "score must be an integer between 0 and 100" };
  }
  if (typeof record.reason !== "string" || record.reason.trim().length === 0) {
    return { ok: false, error: "reason must be a non-empty string" };
  }
  if (!isStringArray(record.strengths)) {
    return { ok: false, error: "strengths must be an array of strings" };
  }
  if (!isStringArray(record.missing_skills)) {
    return { ok: false, error: "missing_skills must be an array of strings" };
  }
  if (typeof record.preference_alignment !== "string" || record.preference_alignment.trim().length === 0) {
    return { ok: false, error: "preference_alignment must be a non-empty string" };
  }

  return {
    ok: true,
    value: {
      score: record.score,
      reason: record.reason,
      strengths: record.strengths,
      missingSkills: record.missing_skills,
      preferenceAlignment: record.preference_alignment,
    },
  };
}
