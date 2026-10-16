// Precision-first work-arrangement classifier for unstructured job-posting
// text (e.g. a LinkedIn job description), where no structured provider field
// exists (bebity's own `workType` is empty for 100% of real Lebanon jobs
// sampled — see docs/LINKEDIN_JOB_DISCOVERY_RESEARCH.md). Distinct from
// normalizeLocation.ts's detectWorkArrangement(), which is designed for a
// short, already-structured location/workplace string (e.g. a Greenhouse
// "Remote - US only" field) and has no false-positive defenses — feeding it
// a multi-paragraph description would misfire on phrases like "hybrid cloud
// infrastructure" or "collaborate with remote teams".
//
// Core principle (never weakened): PRECISION FIRST, COVERAGE SECOND. Never
// infer from city, country, company, title alone, office address, recruiter
// text, or vague flexibility language. When the evidence is not explicit and
// role-specific, return null — a false label actively damages matching
// trust (a remote-only user shown an onsite job because of a guess), while
// null is always safe (checkJobEligibility.ts already treats null as
// "unknown", never as a silent "onsite").
//
// This output is designed to feed normalizeLocation()'s existing
// `providerWorkArrangement` hint parameter unchanged — see
// providers/bayt.ts's `providerWorkArrangement: raw.isRemote === true ?
// "remote" : null` for the established pattern this follows (a provider
// derives a hint from its own best evidence; normalizeLocation trusts it
// when present). No other ingestion code needs to change to consume this.

import type { WorkArrangement } from "./normalizeLocation.ts";

export type ClassificationConfidence = "high" | "medium";
export type ClassificationMethod = "rule" | "ai";

export interface WorkArrangementClassification {
  workArrangement: WorkArrangement | null;
  confidence: ClassificationConfidence | null;
  /** Exact short fragment from the source text — never invented, never paraphrased. */
  evidence: string | null;
  method: ClassificationMethod | null;
}

export interface ClassifyWorkArrangementInput {
  title?: string | null;
  description: string | null | undefined;
}

const NULL_RESULT: WorkArrangementClassification = { workArrangement: null, confidence: null, evidence: null, method: null };

function trimEvidence(text: string, maxLen = 160): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > maxLen ? `${t.slice(0, maxLen - 1)}…` : t;
}

/** Naive sentence split — good enough for short job-posting prose; never needs to be grammatically perfect, only to isolate a positive match from an unrelated disqualifying phrase elsewhere in the text. */
function splitSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?])\s+|\n+|(?=\s[•*-]\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------
// Disqualifying context (Phase 4/11): a sentence containing one of these
// is never used as positive evidence, regardless of which strong pattern
// below would otherwise match inside it. Checked first, per sentence.
// ---------------------------------------------------------------------
const DISQUALIFYING_PATTERNS: RegExp[] = [
  /remote\s+teams?/i,
  /remote\s+access/i,
  /remote\s+support/i,
  /remote\s+(server|servers|desktop|infrastructure|monitoring)/i,
  /hybrid\s+cloud/i,
  /hybrid\s+(infrastructure|environment)\b(?!\s+for\s+(this|the)\s+(role|position))/i,
  /on-?site\s+(client|customer)\s+(visit|visits)/i,
  /on-?site\s+support/i,
  /powered\s+by\s+both\s+on-?site\s+and\s+remote/i, // company-wide staffing-model boilerplate, not role-specific
  /both\s+on-?site\s+and\s+remote\s+(agents|employees|staff|workers|teams)/i,
  /collaborat\w*\s+with\s+remote/i,
  /support\s+(both\s+)?on-?site\s+and\s+remote\s+customers/i,
  /flexible\s+work(ing)?\s+arrangements?\b(?!\s*[:-]\s*(remote|hybrid|on-?site))/i, // vague flexibility alone, unless immediately clarified
  /flexible\s+remote\s+work\s+environment/i, // soft/vague qualifier per task's own borderline example — demoted, not disqualified entirely (handled separately below as medium)
  // Real false positive found during manual validation (Phase 11, this
  // module's own audit): "a brand new Beirut office (for those who would
  // prefer hybrid-working)!" describes an elective perk some employees may
  // choose, not this role's own defined arrangement — conditional "for
  // those who (would) prefer ..." framing is never a role-level statement.
  /for\s+those\s+who\s+(would\s+)?prefer\b/i,
  /\bif\s+you\s+prefer\b.*\b(hybrid|remote|on-?site)\b/i,
];

// The "flexible remote work environment" case is real (seen in real data)
// and the task explicitly flags it as borderline, not a clean reject —
// treat it as its own medium-confidence signal rather than a hard
// disqualifier, by excluding it from the hard-disqualify list used before
// strong-pattern matching and only disqualifying the fully-generic
// "flexible work arrangements" phrasing.
const HARD_DISQUALIFYING_PATTERNS = DISQUALIFYING_PATTERNS.filter(
  (re) => re.source !== /flexible\s+remote\s+work\s+environment/i.source
);

function isDisqualified(sentence: string): boolean {
  return HARD_DISQUALIFYING_PATTERNS.some((re) => re.test(sentence));
}

// ---------------------------------------------------------------------
// Negation (Phase 4): must be checked before a sentence is accepted as
// positive evidence for "remote" or "onsite" — "not a remote position"
// must never be read as confirming remote.
// ---------------------------------------------------------------------
const REMOTE_NEGATION_RE = /\bnot\s+(a\s+)?remote\b|\bremote\s+work\s+is\s+not\s+available\b|\bno\s+remote\s+(work|option)\b/i;
const ONSITE_NEGATION_RE = /\bnot\s+(an?\s+)?on-?site\b/i;

// ---------------------------------------------------------------------
// Strong patterns (Phase 3) — role-specific, explicit. Hybrid's explicit
// day-split pattern is checked first and wins precedence over a bare
// "hybrid" mention per Phase 13's precedence (explicit schedule > bare
// label).
// ---------------------------------------------------------------------
const HYBRID_SCHEDULE_RE =
  /\b\d\s*[-–]?\s*\d?\s*days?\s+(on-?site|in\s+(the\s+)?office)\s*(\/|and|,)?\s*\d\s*[-–]?\s*\d?\s*days?\s+remote\b|\bremote\s*(\/|and|,)?\s*\d\s*[-–]?\s*\d?\s*days?\s+(on-?site|in\s+(the\s+)?office)\b|\bpartly\s+remote\s+and\s+partly\s+on-?site\b|\bprimarily\s+on-?site\s+with\s+one\s+remote\s+day\b/i;

const HYBRID_LABEL_RE = /\bhybrid\s+(work(ing)?\s+(model|arrangement)|role|position|approach)\b|\bhybrid\s+model\b/i;
const HYBRID_BARE_RE = /\bhybrid\b/i; // only used after disqualification + after the above two fail, and only combined with corroborating onsite/remote-day context already covered by HYBRID_SCHEDULE_RE — bare "hybrid" alone (e.g. a one-word benefits bullet "Hybrid working arrangement") is still accepted since it's not inside a disqualifying context.

const REMOTE_STRONG_RE =
  /\bfully\s+remote\b|\b100%\s*remote\b|\bremote\s+position\b|\bremote\s+role\b|\bwork[\s-]?from[\s-]?home\b|\bwfh\b|\bwork\s+remotely\b|\bthis\s+position\s+is\s+remote\b|\bhome[\s-]?based\b|\bwork[\s-]?at[\s-]?home\b|\bremote\s+work[\s-]?at[\s-]?home\b|\bremote[\s-]?first\b/i;
const REMOTE_MEDIUM_RE = /\bremote\s+work\s+environment\b|\bflexible\s+remote\s+work\s+environment\b/i;

const ONSITE_STRONG_RE =
  /\bon-?site\s+(position|role)\b|\boffice-?based\s+position\b|\bmust\s+work\s+from\s+(the\s+)?office\b|\bfully\s+on-?site\b|\b100%\s*on-?site\b|\bin-?office\s+role\b|\bwork\s+from\s+office\b/i;

// Marriott/Sheraton-family ATS exports often paste their internal field
// dump straight into the LinkedIn description (e.g. "Schedule Full Time
// Located Remotely? N Position Type Non-Management ..."). This is a
// structured, unambiguous field echo, not prose — checked against the full
// text (not sentence-isolated) since the literal "?" is itself a sentence
// boundary for splitSentences() and would otherwise separate the label from
// its Y/N answer.
const LOCATED_REMOTELY_RE = /located\s+remotely\?\s*(y(es)?|n(o)?)\b/i;

function findMatch(sentences: string[], re: RegExp): string | null {
  for (const s of sentences) {
    if (isDisqualified(s)) continue;
    if (re.test(s)) return s;
  }
  return null;
}

/**
 * Role-specific title signal (Phase 14): trusted only to raise confidence
 * when the description independently corroborates the same arrangement —
 * never trusted alone, never used for classification. A title saying
 * "Remote ..." (leading) or "... (Remote)" (trailing — a real pattern found
 * during the second-batch false-negative audit, e.g. "Flutter Developer
 * (Remote)") with no corroborating description text is reported via
 * `titleOnlySignal` on the result object extension purely for monitoring.
 */
function titleSignal(title: string | null | undefined): WorkArrangement | null {
  if (!title) return null;
  const t = title.trim();
  if (/^remote\b/i.test(t) || /[(\-–]\s*remote\s*\)?\s*$/i.test(t)) return "remote";
  if (/^hybrid\b/i.test(t) || /[(\-–]\s*hybrid\s*\)?\s*$/i.test(t)) return "hybrid";
  if (/^on-?site\b/i.test(t) || /[(\-–]\s*on-?site\s*\)?\s*$/i.test(t)) return "onsite";
  return null;
}

export interface ClassifyWorkArrangementResult extends WorkArrangementClassification {
  /** Set when the title explicitly states a mode but the description has no corroborating evidence — surfaced for monitoring, never used to classify (Phase 14). */
  titleOnlySignal: WorkArrangement | null;
}

export function classifyWorkArrangementFromText(input: ClassifyWorkArrangementInput): ClassifyWorkArrangementResult {
  const description = input.description?.trim();
  const titleHint = titleSignal(input.title);

  if (!description) {
    return { ...NULL_RESULT, titleOnlySignal: titleHint };
  }

  // Structured ATS field echo (checked against the full text, not
  // sentence-isolated — see LOCATED_REMOTELY_RE's own comment).
  const locatedRemotelyMatch = description.match(LOCATED_REMOTELY_RE);
  if (locatedRemotelyMatch) {
    const isYes = /^y/i.test(locatedRemotelyMatch[1]);
    return {
      workArrangement: isYes ? "remote" : "onsite",
      confidence: "high",
      evidence: trimEvidence(locatedRemotelyMatch[0]),
      method: "rule",
      titleOnlySignal: null,
    };
  }

  const sentences = splitSentences(description);

  // Precedence 1: explicit hybrid schedule (Phase 13 rule 1) — wins over
  // any other signal found elsewhere in the same description, since a
  // "2-3 days on-site / 2-3 remote" statement is a single, unambiguous,
  // more-informative description of one real arrangement.
  const hybridSchedule = findMatch(sentences, HYBRID_SCHEDULE_RE);
  if (hybridSchedule) {
    return { workArrangement: "hybrid", confidence: "high", evidence: trimEvidence(hybridSchedule), method: "rule", titleOnlySignal: null };
  }

  const hybridLabel = findMatch(sentences, HYBRID_LABEL_RE);
  if (hybridLabel) {
    return { workArrangement: "hybrid", confidence: "high", evidence: trimEvidence(hybridLabel), method: "rule", titleOnlySignal: null };
  }

  // Negation check before accepting a bare remote/onsite match.
  const remoteNegated = sentences.some((s) => REMOTE_NEGATION_RE.test(s));
  const onsiteNegated = sentences.some((s) => ONSITE_NEGATION_RE.test(s));

  const remoteStrong = !remoteNegated ? findMatch(sentences, REMOTE_STRONG_RE) : null;
  const onsiteStrong = !onsiteNegated ? findMatch(sentences, ONSITE_STRONG_RE) : null;

  if (remoteStrong && onsiteStrong) {
    // Genuinely conflicting, unrelated signals that survived disqualification —
    // never guess which one governs. Phase 13's ambiguous-mixed-signal rule.
    return { ...NULL_RESULT, titleOnlySignal: titleHint };
  }

  if (remoteStrong) {
    return { workArrangement: "remote", confidence: "high", evidence: trimEvidence(remoteStrong), method: "rule", titleOnlySignal: null };
  }

  if (onsiteStrong) {
    return { workArrangement: "onsite", confidence: "high", evidence: trimEvidence(onsiteStrong), method: "rule", titleOnlySignal: null };
  }

  // Bare "hybrid" label (e.g. a one-line benefits bullet: "Hybrid working
  // arrangement" already matched above by HYBRID_LABEL_RE; this covers a
  // truly bare, unqualified "Hybrid" token not caught by either hybrid
  // pattern yet still outside any disqualifying context).
  const hybridBare = findMatch(sentences, HYBRID_BARE_RE);
  if (hybridBare) {
    return { workArrangement: "hybrid", confidence: "high", evidence: trimEvidence(hybridBare), method: "rule", titleOnlySignal: null };
  }

  // Medium-confidence remote phrasing (Phase 3/6: "flexible remote work
  // environment" — real data, borderline per the task's own instruction).
  const remoteMedium = !remoteNegated ? findMatch(sentences, REMOTE_MEDIUM_RE) : null;
  if (remoteMedium) {
    return { workArrangement: "remote", confidence: "medium", evidence: trimEvidence(remoteMedium), method: "rule", titleOnlySignal: null };
  }

  // No explicit, role-specific, non-disqualified evidence found. Title
  // alone is never sufficient (Phase 14) — surfaced for monitoring only.
  return { ...NULL_RESULT, titleOnlySignal: titleHint };
}
