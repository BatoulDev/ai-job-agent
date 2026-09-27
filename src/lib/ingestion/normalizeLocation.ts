// Pure, deterministic location normalization for raw provider/job-posting
// location strings. No network calls, no DB reads/writes, no AI. Consumed
// by the (future) ingestion pipeline before a RawProviderJob is persisted
// as a JobContract — see docs/OVERNIGHT_BUILD_PROGRESS.md Phase 01.
//
// Contract: given the same input, this function always returns the same
// output. When a signal is ambiguous or absent, the function never
// guesses — it reports low confidence instead of picking a plausible
// answer. Downstream eligibility logic (Phase 02) is expected to fail
// closed on low-confidence rows rather than trust a guess.
//
// Country codes are ISO 3166-1 alpha-2 and match public.countries.code
// (supabase/migrations/20260806090000_create_countries.sql). Work
// arrangement values match the public.jobs.work_arrangement check
// constraint (supabase/migrations/20260809090030_create_jobs.sql):
// 'remote' | 'onsite' | 'hybrid' | 'flexible'.

export type WorkArrangement = "remote" | "onsite" | "hybrid" | "flexible";

export type LocationConfidence = "high" | "medium" | "low";

export interface NormalizeLocationInput {
  /** Raw location string exactly as scraped/provided. */
  rawLocation: string | null | undefined;
  /**
   * Optional provider-supplied work-arrangement hint (e.g. a Greenhouse
   * "remote" flag, an Ashby office field, a Lever category). Trusted
   * over text inference from rawLocation when present and recognized.
   */
  providerWorkArrangement?: string | null;
}

export interface NormalizedLocation {
  rawLocation: string | null;
  /** ISO 3166-1 alpha-2, or null when no single country can be determined. */
  countryCode: string | null;
  /** City name in a stable canonical form, or null when unknown/ambiguous. */
  city: string | null;
  workArrangement: WorkArrangement | null;
  /**
   * Geographic eligibility scope for a remote job (null when the job is
   * not remote, or the scope could not be determined). Free-form by
   * design — mirrors public.jobs.remote_scope, which is intentionally
   * unconstrained pending real matching-worker query needs. Known
   * deterministic values this function ever produces: "worldwide",
   * "country:<ISO_CODE>", "region:mena", "region:gcc".
   */
  remoteScope: string | null;
  /**
   * true = text explicitly offers relocation/visa sponsorship, false =
   * text explicitly rules it out, null = not mentioned/unknown.
   */
  relocationSignal: boolean | null;
  locationConfidence: LocationConfidence;
}

interface CityEntry {
  city: string;
  countryCode: string;
  aliases: string[];
}

// Deliberately scoped to this product's supported markets (AGENTS.md
// §6/§9 of the founder rules: Lebanon, Saudi Arabia, Qatar, Kuwait, UAE)
// plus a handful of high-frequency international remote-market countries
// that show up in "Remote (US only)" style scope text. Extend by adding
// rows here — no other code needs to change (AGENTS.md §16/§34
// maintainability guardrail).
const KNOWN_CITIES: CityEntry[] = [
  { city: "Beirut", countryCode: "LB", aliases: ["beirut", "beyrouth"] },
  { city: "Tripoli", countryCode: "LB", aliases: ["tripoli", "trablous"] },
  { city: "Sidon", countryCode: "LB", aliases: ["sidon", "saida"] },
  { city: "Tyre", countryCode: "LB", aliases: ["tyre", "sour"] },
  { city: "Jounieh", countryCode: "LB", aliases: ["jounieh"] },
  { city: "Byblos", countryCode: "LB", aliases: ["byblos", "jbeil"] },
  { city: "Zahle", countryCode: "LB", aliases: ["zahle", "zahleh"] },
  { city: "Baabda", countryCode: "LB", aliases: ["baabda"] },
  { city: "Riyadh", countryCode: "SA", aliases: ["riyadh"] },
  { city: "Jeddah", countryCode: "SA", aliases: ["jeddah", "jiddah"] },
  { city: "Dammam", countryCode: "SA", aliases: ["dammam"] },
  { city: "Khobar", countryCode: "SA", aliases: ["khobar", "al khobar"] },
  { city: "Mecca", countryCode: "SA", aliases: ["mecca", "makkah"] },
  { city: "Medina", countryCode: "SA", aliases: ["medina", "madinah"] },
  { city: "Doha", countryCode: "QA", aliases: ["doha"] },
  { city: "Kuwait City", countryCode: "KW", aliases: ["kuwait city"] },
  { city: "Hawalli", countryCode: "KW", aliases: ["hawalli"] },
  { city: "Salmiya", countryCode: "KW", aliases: ["salmiya"] },
  { city: "Dubai", countryCode: "AE", aliases: ["dubai"] },
  { city: "Abu Dhabi", countryCode: "AE", aliases: ["abu dhabi"] },
  { city: "Sharjah", countryCode: "AE", aliases: ["sharjah"] },
  { city: "Ajman", countryCode: "AE", aliases: ["ajman"] },
  { city: "Ras Al Khaimah", countryCode: "AE", aliases: ["ras al khaimah", "rak"] },
  { city: "Fujairah", countryCode: "AE", aliases: ["fujairah"] },
];

// Country-name recognition, independent of city. Ordered so multi-word
// aliases are checked before shorter ones that could be substrings.
const KNOWN_COUNTRIES: Array<{ countryCode: string; aliases: string[] }> = [
  { countryCode: "LB", aliases: ["lebanon", "liban"] },
  { countryCode: "SA", aliases: ["saudi arabia", "ksa", "kingdom of saudi arabia"] },
  { countryCode: "QA", aliases: ["qatar"] },
  { countryCode: "KW", aliases: ["kuwait"] },
  { countryCode: "AE", aliases: ["united arab emirates", "u.a.e.", "uae"] },
  { countryCode: "US", aliases: ["united states", "u.s.a.", "usa", "us only"] },
  { countryCode: "GB", aliases: ["united kingdom", "u.k.", "uk only"] },
  { countryCode: "CA", aliases: ["canada"] },
  { countryCode: "DE", aliases: ["germany"] },
  { countryCode: "IN", aliases: ["india"] },
  { countryCode: "FR", aliases: ["france"] },
];

const GCC_COUNTRY_CODES = new Set(["SA", "QA", "KW", "AE", "BH", "OM"]);
const MENA_COUNTRY_CODES = new Set([
  "LB", "SA", "QA", "KW", "AE", "BH", "OM", "EG", "JO", "IQ", "SY", "MA", "TN", "DZ", "LY", "YE", "SD", "PS",
]);

const REMOTE_KEYWORDS = ["remote", "work from home", "wfh", "telecommute", "fully distributed"];
const HYBRID_KEYWORDS = ["hybrid"];
const ONSITE_KEYWORDS = ["on-site", "onsite", "in office", "in-office"];
const FLEXIBLE_KEYWORDS = ["flexible"];

const WORLDWIDE_KEYWORDS = ["worldwide", "anywhere", "global", "any location", "any country"];
const RELOCATION_POSITIVE_KEYWORDS = [
  "relocation assistance",
  "relocation package",
  "relocation support",
  "visa sponsorship",
  "will sponsor",
  "sponsor visa",
  "we will relocate you",
  "relocation provided",
];
const RELOCATION_NEGATIVE_KEYWORDS = [
  "no relocation",
  "no visa sponsorship",
  "not offer relocation",
  "no sponsorship",
  "local candidates only",
  "must already reside",
  "must already be based",
  "candidates must be based",
];

function normalizeText(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function detectWorkArrangement(
  normalizedRaw: string,
  providerWorkArrangement: string | null | undefined,
): WorkArrangement | null {
  const hint = providerWorkArrangement ? normalizeText(providerWorkArrangement) : null;
  if (hint) {
    if (REMOTE_KEYWORDS.some((k) => hint === k || hint.includes(k))) return "remote";
    if (HYBRID_KEYWORDS.some((k) => hint.includes(k))) return "hybrid";
    if (ONSITE_KEYWORDS.some((k) => hint.includes(k))) return "onsite";
    if (FLEXIBLE_KEYWORDS.some((k) => hint.includes(k))) return "flexible";
  }

  if (containsAny(normalizedRaw, HYBRID_KEYWORDS)) return "hybrid";
  if (containsAny(normalizedRaw, REMOTE_KEYWORDS)) return "remote";
  if (containsAny(normalizedRaw, FLEXIBLE_KEYWORDS)) return "flexible";
  if (containsAny(normalizedRaw, ONSITE_KEYWORDS)) return "onsite";
  return null;
}

function detectRelocationSignal(normalizedRaw: string): boolean | null {
  if (containsAny(normalizedRaw, RELOCATION_NEGATIVE_KEYWORDS)) return false;
  if (containsAny(normalizedRaw, RELOCATION_POSITIVE_KEYWORDS)) return true;
  return null;
}

interface CountryMatch {
  countryCode: string;
  city: string | null;
}

/** Finds every distinct country the raw text plausibly refers to. */
function findCountryMatches(normalizedRaw: string): CountryMatch[] {
  const matches = new Map<string, string | null>();

  for (const entry of KNOWN_CITIES) {
    if (entry.aliases.some((alias) => normalizedRaw.includes(alias))) {
      const existing = matches.get(entry.countryCode);
      // Prefer the first city match; do not overwrite with a second
      // distinct city for the same country (that's a multi-city
      // ambiguity handled by the caller via matches.size, not silently
      // picked between).
      if (existing === undefined) {
        matches.set(entry.countryCode, entry.city);
      }
    }
  }

  for (const entry of KNOWN_COUNTRIES) {
    if (entry.aliases.some((alias) => normalizedRaw.includes(alias))) {
      if (!matches.has(entry.countryCode)) {
        matches.set(entry.countryCode, null);
      }
    }
  }

  return Array.from(matches.entries()).map(([countryCode, city]) => ({ countryCode, city }));
}

function detectRemoteScope(normalizedRaw: string, countryMatches: CountryMatch[]): string | null {
  if (containsAny(normalizedRaw, WORLDWIDE_KEYWORDS)) return "worldwide";
  if (normalizedRaw.includes("gcc")) return "region:gcc";
  if (normalizedRaw.includes("mena") || normalizedRaw.includes("middle east")) return "region:mena";
  if (countryMatches.length === 1) return `country:${countryMatches[0].countryCode}`;
  return null;
}

export function normalizeLocation(input: NormalizeLocationInput): NormalizedLocation {
  const rawLocation = input.rawLocation?.trim() || null;

  if (!rawLocation) {
    return {
      rawLocation: null,
      countryCode: null,
      city: null,
      workArrangement: detectWorkArrangement("", input.providerWorkArrangement) ?? null,
      remoteScope: null,
      relocationSignal: null,
      locationConfidence: "low",
    };
  }

  const normalizedRaw = normalizeText(rawLocation);
  const workArrangement = detectWorkArrangement(normalizedRaw, input.providerWorkArrangement);
  const relocationSignal = detectRelocationSignal(normalizedRaw);
  const countryMatches = findCountryMatches(normalizedRaw);

  const isMultiRegion = countryMatches.length > 1;
  const singleMatch = countryMatches.length === 1 ? countryMatches[0] : null;

  // Multi-region text ("Beirut, Dubai, or Riyadh") must never collapse
  // to one country/city — that would be a guess, not a normalization.
  const countryCode = isMultiRegion ? null : singleMatch?.countryCode ?? null;
  const city = isMultiRegion ? null : singleMatch?.city ?? null;

  const remoteScope =
    workArrangement === "remote" ? detectRemoteScope(normalizedRaw, countryMatches) : null;

  let locationConfidence: LocationConfidence;
  if (isMultiRegion) {
    locationConfidence = "low";
  } else if (workArrangement === "remote") {
    locationConfidence = remoteScope ? "high" : "medium";
  } else if (countryCode && city) {
    locationConfidence = "high";
  } else if (countryCode) {
    locationConfidence = "medium";
  } else {
    locationConfidence = "low";
  }

  return {
    rawLocation,
    countryCode,
    city,
    workArrangement,
    remoteScope,
    relocationSignal,
    locationConfidence,
  };
}

/** True when downstream eligibility logic should treat this as unusable without a human review pass. */
export function isLowConfidenceLocation(location: NormalizedLocation): boolean {
  return location.locationConfidence === "low";
}

export function isGccCountryCode(countryCode: string | null): boolean {
  return !!countryCode && GCC_COUNTRY_CODES.has(countryCode);
}

export function isMenaCountryCode(countryCode: string | null): boolean {
  return !!countryCode && MENA_COUNTRY_CODES.has(countryCode);
}
