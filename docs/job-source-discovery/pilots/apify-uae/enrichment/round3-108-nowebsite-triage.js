// Round 3, triage of the 108 "eligible_employer_no_website" candidates.
// Strategy: rank by Google review count (a real-world business-scale proxy), deep-research the strongest few
// via WebSearch/WebFetch for an independently-discoverable official source, and hold the rest as needs_more_evidence
// (real, plausible candidates that simply lack any discoverable official domain) or reject clear individual-practitioner
// duplicates - per the explicit instruction not to over-invest time in small/unverifiable businesses.
module.exports = {
  // [internal_row_id, classification, notes]
  researched: [
    ['uae-pilot-0284', 'duplicate_or_branch', 'Mafraq Hospital (450 reviews, Abu Dhabi) - WebSearch confirms this legacy hospital brand was absorbed into Sheikh Shakhbout Medical City (SSMC), a SEHA/Mayo Clinic joint venture; no separate "Mafraq Hospital" careers channel exists any longer. Not independently promotable as its own entity - a genuine branch/absorption case, not a fresh discovery. SSMC itself is not in this candidate pool and was not added.'],
    ['uae-pilot-0393', 'duplicate_or_branch', 'Sheikh Khalifa Medical City (84 reviews, "Psychiatric hospital" category) - the same SKMC entity already tracked in this pilot\'s backlog as uae-pilot-0394 (Sheikh Khalifa Medical City - Emergency Department), part of the blocked seha.ae family. Not a separate employer.'],
    ['uae-pilot-0179', 'needs_more_evidence', 'Drydocks World Main Gate (35 reviews, Dubai) - WebSearch confirms a real official careers page at drydocks.gov.ae/en/portal/career.hold.aspx (a .gov.ae domain, corroborated by multiple independent third-party job-aggregator listings), but the domain itself returned HTTP 403 on direct WebFetch (consistent with the same bot-protection pattern seen elsewhere this pilot) - held per the explicit rule against verifying from a search snippet alone. High-value target for a future pass via a different access method; a large, real, government-linked maritime employer (10,000+ workforce claimed).'],
    ['uae-pilot-0319', 'needs_more_evidence', 'National Contracting Company Ltd - UAE Branch (77 reviews, Abu Dhabi) - WebSearch surfaced at least 5 differently-named/domained "National Contracting Company" / "NCC" entities (nccprojects.com, nccauh.ae, national-contracting.com, ncc-me.com, ncc-dubai.net, nccholding.com), including one described as a Saudi-origin company with a UAE branch. A genuine, unresolved name-collision risk - not guessed at or arbitrarily matched to one domain.'],
    ['uae-pilot-0105', 'needs_more_evidence', 'Awtad Engineering Consultancy (30 reviews, 4.5 rating, Abu Dhabi) - no website field from Google Maps; a quick domain guess was not attempted to avoid fabricating an unverified URL. Held as a real, plausible, unverified lead.'],
    ['uae-pilot-0071', 'needs_more_evidence', 'Almasar Engineering Consultants (29 reviews, 4.5 rating, Abu Dhabi) - no website field; held as a real, plausible, unverified lead.'],
    ['uae-pilot-0321', 'needs_more_evidence', 'National Transport Company LLC / NTC (38 reviews, 4.7 rating, Abu Dhabi) - a guessed domain (ntc.ae) resolved to a domain-resale/parking page, not the real company - the correct official domain was not located this pass. Held as a real, plausible, unverified lead rather than guessed at further.'],
  ],
  // Individual-practitioner rejects (name-pattern match, including one Arabic-language duplicate of an already-rejected candidate)
  rejected: [
    ['uae-pilot-0172', 'Individual-practitioner name pattern ("Dr Layla Clinique") - a personal practice, not a company.'],
    ['uae-pilot-0173', 'Individual-practitioner name pattern ("Dr. Mulham Polyclinic") - a personal practice, not a company.'],
    ['uae-pilot-0466', 'Arabic-language duplicate listing of the same "Dr. Mulham" clinic (uae-pilot-0173) - both the English and Arabic Google Maps listings represent one individual practice, not two companies.'],
  ],
  // The Zayed Military Hospital Emergency listing is a duplicate of an already-tracked round-1 candidate
  duplicates_of_tracked: [
    ['uae-pilot-0456', 'uae-pilot-0455', 'Zayed Military Hospital Emergency - Abu Dhabi (26 reviews) is the same hospital as uae-pilot-0455 (Zayed Military Hospital), already tracked in the round-1 backlog under the blocked seha.ae family - not a separate employer.'],
    ['uae-pilot-0467', 'uae-pilot-0394', 'مدينة مستشفى خليفة الطبية - الطوارئ (Arabic for "Sheikh Khalifa Medical City - Emergency", 9 reviews) is the same facility as uae-pilot-0394, already tracked in the round-1 backlog under the blocked seha.ae family - not a separate employer.'],
  ],
};
