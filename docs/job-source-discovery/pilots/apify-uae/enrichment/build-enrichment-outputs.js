const fs = require('fs');
const path = require('path');
const CRLF = '\r\n';
function csvField(v) { v = v===null||v===undefined?'':String(v); if (/[",\n]/.test(v)) return '"'+v.replace(/"/g,'""')+'"'; return v; }
function writeCsv(p, header, rows) {
  const lines = [header.map(csvField).join(',')].concat(rows.map(r => header.map(h=>csvField(r[h])).join(',')));
  fs.writeFileSync(p, lines.join(CRLF)+CRLF);
}
function parseCSV(text) {
  const rows = []; let row=[], field='', inQ=false;
  for (let i=0;i<text.length;i++){
    const c=text[i];
    if (inQ){ if(c==='"'){ if(text[i+1]==='"'){field+='"';i++;} else inQ=false; } else field+=c; }
    else { if(c==='"') inQ=true; else if(c===','){row.push(field);field='';} else if(c==='\n'){row.push(field);rows.push(row);row=[];field='';} else if(c==='\r'){} else field+=c; }
  }
  if (field.length||row.length){row.push(field);rows.push(row);}
  return rows;
}
function loadCsv(p) {
  const txt = fs.readFileSync(p,'utf8').replace(/^﻿/, '');
  const rows = parseCSV(txt).filter(r=>r.length>1);
  const header = rows[0];
  return rows.slice(1).map(r => { const o={}; header.forEach((h,i)=>o[h]=r[i]); return o; });
}

const selected = loadCsv(path.join(__dirname, 'selected-for-enrichment.csv'));
const byId = {};
for (const r of selected) byId[r.internal_row_id] = r;

// Manually compiled enrichment findings (from direct WebFetch of each candidate's own official domain, 2026-09-07)
const findings = [
  // id, website_verification_status, careers_source_type, careers_page_url, ats_provider_detected, current_open_jobs_detected, notes, final_status
  ['uae-pilot-0270', 'confirmed_official', 'dedicated_careers_page', 'https://www.killadesign.com/careers/', 'unknown_not_itemized', 'unknown', 'Award-winning Dubai architecture firm (Museum of the Future, Jumeirah Marsa Al Arab). Dedicated careers page confirmed in main nav.', 'new_verified'],
  ['uae-pilot-0163', 'confirmed_official', 'dedicated_careers_page', 'https://design-infinity.com/careers/', 'unknown_not_itemized', 'unknown', 'Interior design/fit-out firm, founded 2012, 1500+ staff claimed, offices in BOTH Dubai and Abu Dhabi (DIP HQ + Abu Dhabi office) - dual-city coverage confirmed directly.', 'new_verified'],
  ['uae-pilot-0129', 'confirmed_official', 'dedicated_careers_page', 'http://www.capitalengg.com/careers', 'unknown_not_itemized', 'unknown', 'Multi-disciplinary engineering consultancy, est. 2006, ISO/ICV certified, MENA Winner Award 2024, operations in 7 countries. HQ address shown is Sharjah (Abu Shagara) even though discovered via an Abu Dhabi Google Maps search - flagged in researcher_notes, kept as Abu Dhabi market presence per the Google Maps evidence rather than guessed away.', 'new_verified'],
  ['uae-pilot-0079', 'confirmed_official', 'dedicated_careers_page', 'https://amaaudit.com/careers/', 'unknown_not_itemized', 'unknown', 'Audit/tax/advisory firm est. 1999, PrimeGlobal network member, offices in Abu Dhabi, Dubai, India, Singapore, USA.', 'new_verified'],
  ['uae-pilot-0413', 'confirmed_official', 'dedicated_careers_page', 'https://www.sundusglobal.com/sundus-job-search', 'custom_portal_ruyacareers', 'unknown', 'HR recruitment/outsourcing agency, 27 years established, 10,000+ outsourced staff, 500+ clients. Directly closes the HR/recruitment sector gap flagged in the UAE baseline. Secondary portal ruyacareers.ae also referenced.', 'new_verified'],
  ['uae-pilot-0327', 'confirmed_official', 'confirmed_ats', 'https://eiby.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1', 'Oracle Cloud HCM', 'unknown_portal_confirmed_not_itemized', 'NMC Specialty Hospital Abu Dhabi, part of NMC Healthcare (major UAE hospital group). Two distinct Oracle Cloud portals confirmed: a main careers site and a separate UAE-Nationals-specific site.', 'new_verified'],
  ['uae-pilot-0299', 'confirmed_official', 'dedicated_careers_page', 'https://medeor.ae/careers/', 'unknown_not_itemized', 'unknown', 'JCI-accredited multi-specialty hospital, Abu Dhabi location confirmed directly.', 'new_verified'],
  ['uae-pilot-0236', 'confirmed_official', 'dedicated_careers_page', 'https://healthpoint.ae/careers/', 'unknown_not_itemized', 'unknown', 'Multispecialty hospital, part of the M42 group (major Abu Dhabi health-tech conglomerate), MOHAP-licensed.', 'new_verified'],
  ['uae-pilot-0232', 'confirmed_official', 'dedicated_careers_page', 'https://www.hsmc.ae/careers/', 'unknown_not_itemized', 'unknown', 'JCI-certified medical centre, MOH-licensed, Marina Village Abu Dhabi.', 'new_verified'],
  ['uae-pilot-0221', 'confirmed_official', 'dedicated_careers_page', 'https://gch.ae/careers/', 'unknown_not_itemized', 'unknown', 'Licensed hospital in Al Manhal area, Abu Dhabi.', 'new_verified'],

  // needs_manual_review: legitimate company, official site confirmed, but no dedicated careers page/ATS found - only a general contact channel
  ['uae-pilot-0301', 'confirmed_official', 'none_found_general_contact_only', '', 'none', 'unknown', 'Real architecture firm (30+ yrs, LEED/Estidama), but only a general contact form found, no careers page or hiring-specific email.', 'needs_manual_review'],
  ['uae-pilot-0203', 'confirmed_official', 'none_found_general_contact_only', '', 'none', 'unknown', 'Real interior decoration company, Business Bay Dubai, but no careers page found - only general info@ email.', 'needs_manual_review'],
  ['uae-pilot-0368', 'confirmed_official', 'none_found_general_contact_only', '', 'none', 'unknown', 'Real interior design/fit-out studio est. 1999, 1500+ projects, 4.4* / 105 reviews, but no careers page found.', 'needs_manual_review'],
  ['uae-pilot-0009', 'confirmed_official', 'none_found_general_contact_only', '', 'none', 'unknown', 'Real logistics group with several subsidiaries (Aamer Consultancy/Logistics/Business/Delivery/Digital Hub), but no careers page found - hiring may vary by division.', 'needs_manual_review'],
  ['uae-pilot-0206', 'confirmed_official', 'none_found_general_contact_only', '', 'none', 'unknown', 'Real tax/accounting consultancy (Fastlane Career LLC), but despite the "Career" brand name, no dedicated careers/jobs page found - only a general inquiry form.', 'needs_manual_review'],
  ['uae-pilot-0062', 'confirmed_official', 'none_found_general_contact_only', '', 'none', 'unknown', 'Real freight/cargo company, Sharjah HQ with a Dubai office, 11+ yrs claimed, but no careers page found.', 'needs_manual_review'],
  ['uae-pilot-0278', 'confirmed_official', 'none_found_general_contact_only', '', 'none', 'unknown', 'Real accounting/tax firm, but no careers page found.', 'needs_manual_review'],
  ['uae-pilot-0023', 'confirmed_official', 'none_found_general_contact_only', '', 'none', 'unknown', 'Real accounting/consulting firm, but no careers page found.', 'needs_manual_review'],
  ['uae-pilot-0199', 'confirmed_official', 'none_found_general_contact_only', '', 'none', 'unknown', 'Real HSE training/consultancy est. 1992, offices in Dubai, Abu Dhabi, RAK, and Riyadh (multi-emirate coverage), but no careers page found - only functional business/head-office emails.', 'needs_manual_review'],
  ['uae-pilot-0275', 'confirmed_official', 'none_found_general_contact_only', '', 'none', 'unknown', 'Real medical center, MOH-registered, est. since 1999, but no careers page found.', 'needs_manual_review'],
  ['uae-pilot-0054', 'confirmed_official', 'none_found_general_contact_only', '', 'none', 'unknown', 'Real multi-specialty clinic, JCIA-accredited, Dubai and Sharjah presence, but no careers page found.', 'needs_manual_review'],
  ['uae-pilot-0331', 'confirmed_official', 'none_found_general_contact_only', '', 'none', 'unknown', 'Real medical center with 3 Dubai branches, but no careers page found.', 'needs_manual_review'],
  ['uae-pilot-0289', 'confirmed_official', 'none_found_general_contact_only', '', 'none', 'unknown', 'Real medical clinic, Al Diyafah Dubai, but no careers page found.', 'needs_manual_review'],

  // blocked/technical - real company, evidence incomplete due to a technical access issue, not a negative finding
  ['uae-pilot-0389', 'blocked_technical', 'not_confirmed_this_pass', '', 'unknown', 'unknown', 'TLS certificate expired on sehaemirates.com at fetch time - could not verify careers content this pass. Note: distinct domain from the government SEHA network (seha.ae).', 'needs_manual_review'],
  ['uae-pilot-0388', 'blocked_technical', 'not_confirmed_this_pass', '', 'unknown', 'unknown', 'corniche.seha.ae and the parent seha.ae (Abu Dhabi Health Services Company, the government hospital network) both returned HTTP 403 this pass. High-value target for a future pass - SEHA operates numerous major Abu Dhabi public hospitals.', 'needs_manual_review'],
  ['uae-pilot-0455', 'blocked_technical', 'not_confirmed_this_pass', '', 'unknown', 'unknown', 'Same seha.ae-family domain block as Corniche Hospital above (zmh-elibrary.com not independently re-tried since the parent SEHA network is the more relevant careers entry point).', 'needs_manual_review'],
  ['uae-pilot-0394', 'blocked_technical', 'not_confirmed_this_pass', '', 'unknown', 'unknown', 'skmc.seha.ae is part of the same blocked seha.ae family. This specific Google Maps hit was for the Emergency Department, not the hospital as a whole - would need re-filing under the parent Sheikh Khalifa Medical City entity in a future pass, not as a department.', 'needs_manual_review'],
  ['uae-pilot-0119', 'blocked_technical', 'not_confirmed_this_pass', '', 'unknown', 'unknown', 'TLS hostname mismatch (shared hosting certificate, web-hosting.com) - could not verify careers content this pass.', 'needs_manual_review'],
  ['uae-pilot-0123', 'blocked_technical', 'not_confirmed_this_pass', '', 'unknown', 'unknown', 'brandsforless.com returned HTTP 403 this pass (likely bot-protection). Brands For Less is a well-known large regional discount-retail chain - high-value target for a future pass via a different method. This specific Google Maps hit was one mall branch (Burjuman); a future pass should verify the group entity, not the branch.', 'needs_manual_review'],
  ['uae-pilot-0358', 'blocked_technical', 'not_confirmed_this_pass', '', 'unknown', 'unknown', 'Fetch returned truncated/inconclusive content twice - needs a manual browser check.', 'needs_manual_review'],
  ['uae-pilot-0191', 'blocked_technical', 'not_confirmed_this_pass', '', 'unknown', 'unknown', 'emirateslogistics.com returned empty content on two independent fetch attempts (likely a JS-rendered page) - needs a manual browser check.', 'needs_manual_review'],

  // no official source - domain problems
  ['uae-pilot-0397', 'domain_redirects_to_unrelated_site', 'not_applicable', '', 'not_applicable', 'not_applicable', 'slateinteriorsme.com 301-redirects to an entirely unrelated personal site (jonkinnally.com) - this business no longer controls its former domain, or the domain was reused. No official source available.', 'no_official_source_found'],
  ['uae-pilot-0306', 'social_media_only_no_website', 'not_applicable', '', 'not_applicable', 'not_applicable', 'Google Maps supplied only an Instagram profile link, not an official website - insufficient for verification per this project rules (a social profile alone is not an official site).', 'no_official_source_found'],
];

const findingsById = {};
for (const f of findings) {
  findingsById[f[0]] = {
    website_verification_status: f[1], careers_source_type: f[2], careers_page_url: f[3],
    ats_provider_detected: f[4], current_open_jobs_detected: f[5], notes: f[6], final_status: f[7],
  };
}

// Dropped-from-enrichment-sample candidates (small/individual, not fetched, rejected on categorical grounds)
const droppedIds = ['uae-pilot-0035','uae-pilot-0111','uae-pilot-0463','uae-pilot-0090','uae-pilot-0007','uae-pilot-0065','uae-pilot-0384','uae-pilot-0114','uae-pilot-0234','uae-pilot-0081','uae-pilot-0241','uae-pilot-0175','uae-pilot-0159','uae-pilot-0417','uae-pilot-0084'];

const today = '2026-09-07';
const enrichedRows = [];
for (const r of selected) {
  const f = findingsById[r.internal_row_id];
  if (!f) continue; // dropped from sample
  enrichedRows.push({
    internal_row_id: r.internal_row_id,
    canonical_name: r.canonical_name,
    relevance_status: 'eligible_employer',
    relevance_reason: 'Selected for full enrichment: plausible genuine employer in a UAE-baseline gap sector, ranked by Google review count/rating within its sector-cluster x city cell.',
    google_category: r.categories,
    mapped_industry_guess: r._cluster ? r._cluster.replace(/^g\d_/, '').replace(/_/g, ' ') : '',
    mapped_company_type_guess: 'private',
    regions: '', categories: r.categories, address: r.address, city: r._city, country_code: 'AE', phone: r.phone,
    google_maps_url: r.google_maps_url, google_place_ids: '', google_rating: r.rating, google_reviews_count: r.reviews_count,
    google_supplied_website: r.website, official_website_url: r.website,
    website_verification_status: f.website_verification_status, website_evidence_url: r.website, website_notes: f.notes,
    verification_date: today,
    careers_source_type: f.careers_source_type, careers_page_url: f.careers_page_url, ats_provider_detected: f.ats_provider_detected,
    careers_evidence_url: f.careers_page_url || r.website, careers_notes: f.notes,
    linkedin_company_url: '', linkedin_status: 'not_verified', linkedin_evidence_url: '', linkedin_identity_confidence: 'not_applicable', linkedin_notes: 'Not researched this pass - LinkedIn is never scraped or used for verification per project policy.',
    current_open_jobs_detected: f.current_open_jobs_detected,
    source_confidence: f.final_status === 'new_verified' ? 'high' : 'medium',
    automation_eligibility: f.ats_provider_detected && f.ats_provider_detected !== 'none' && f.ats_provider_detected !== 'unknown' ? 'suitable_public_ats' : (f.careers_page_url ? 'suitable_public_html_subject_to_review' : 'unknown'),
    review_status: f.final_status,
    enrichment_batch_status: 'enriched_2026-09-07',
    researcher_notes: f.notes,
  });
}

const enrichedHeader = ['internal_row_id','canonical_name','relevance_status','relevance_reason','google_category','mapped_industry_guess','mapped_company_type_guess','regions','categories','address','city','country_code','phone','google_maps_url','google_place_ids','google_rating','google_reviews_count','google_supplied_website','official_website_url','website_verification_status','website_evidence_url','website_notes','verification_date','careers_source_type','careers_page_url','ats_provider_detected','careers_evidence_url','careers_notes','linkedin_company_url','linkedin_status','linkedin_evidence_url','linkedin_identity_confidence','linkedin_notes','current_open_jobs_detected','source_confidence','automation_eligibility','review_status','enrichment_batch_status','researcher_notes'];
writeCsv(path.join(__dirname, 'enriched-company-candidates.csv'), enrichedHeader, enrichedRows);

// careers-source-summary.csv (only rows with any careers info)
const careersRows = enrichedRows.filter(r => r.careers_page_url || r.ats_provider_detected !== 'none').map(r => ({
  internal_row_id: r.internal_row_id, canonical_name: r.canonical_name, official_website_url: r.official_website_url,
  careers_source_type: r.careers_source_type, careers_page_url: r.careers_page_url, ats_provider_detected: r.ats_provider_detected,
  careers_evidence_url: r.careers_evidence_url, careers_notes: r.careers_notes,
}));
writeCsv(path.join(__dirname, 'careers-source-summary.csv'),
  ['internal_row_id','canonical_name','official_website_url','careers_source_type','careers_page_url','ats_provider_detected','careers_evidence_url','careers_notes'],
  careersRows);

console.log('enriched rows:', enrichedRows.length);
console.log('by final_status:', enrichedRows.reduce((acc,r)=>{acc[r.review_status]=(acc[r.review_status]||0)+1;return acc;},{}));
console.log('careers-source-summary rows:', careersRows.length);

// --- Append dropped-from-sample + Slate/Modern Home to rejected-candidates.csv ---
const allClassified = loadCsv(path.join(__dirname, 'all-classified-candidates.csv'));
const byIdAll = {}; for (const r of allClassified) byIdAll[r.internal_row_id] = r;
const existingRejected = loadCsv(path.join(__dirname, 'rejected-candidates.csv'));
const newRejectedFromDrop = droppedIds.map(id => {
  const r = byIdAll[id];
  const reasonMap = {
    'uae-pilot-0035': 'Curtain/decor retail shop, not a genuine design-firm-scale employer.',
    'uae-pilot-0111': 'Small decor/soft-furnishing shop.',
    'uae-pilot-0463': 'Small decor/contracting shop (single location).',
    'uae-pilot-0090': 'Insufficient evidence of company scale beyond a single Google Maps listing.',
    'uae-pilot-0007': 'Small single-branch cargo/courier agent.',
    'uae-pilot-0065': 'Small single-branch cargo agent.',
    'uae-pilot-0384': 'Small single-branch courier company.',
    'uae-pilot-0114': 'Single-branch courier ("- Karama" branch qualifier), not a distinct verifiable employer.',
    'uae-pilot-0234': 'Single-branch shipping agent ("AL Karama" branch qualifier).',
    'uae-pilot-0081': 'Category mismatch/unclear business type (Marine supply store), not confirmed as a genuine mid-size employer.',
    'uae-pilot-0241': 'Furniture retail store, not a genuine target-sector employer.',
    'uae-pilot-0175': 'Individual medical practitioner (a person, not a company).',
    'uae-pilot-0159': 'Small single-branch print shop.',
    'uae-pilot-0417': 'Small accounting-software reseller under an individual-sounding trade name.',
    'uae-pilot-0084': 'Single dental clinic, individual-practitioner scale, not a genuine mid-size healthcare employer target.',
  };
  return {
    internal_row_id: id, canonical_name: r ? r.canonical_name : id, relevance_status: 'rejected_low_value_micro_business_or_individual',
    relevance_reason: reasonMap[id] || 'Dropped from the bounded enrichment sample as a low-value micro-business or individual practitioner, not a genuine mid/large employer target for this project.',
    google_category: r ? r.categories : '', regions: r ? r.regions : '', categories: r ? r.categories : '', address: r ? r.address : '', city: r ? r.city : '', phone: r ? r.phone : '', website: r ? r.website : '', google_maps_url: r ? r.google_maps_url : '',
  };
});
const rejectedFromEnrichment = [
  { internal_row_id: 'uae-pilot-0397', canonical_name: 'Slate Stone Interiors', relevance_status: 'no_official_source_found', relevance_reason: 'Website domain (slateinteriorsme.com) 301-redirects to an unrelated site (jonkinnally.com) - no working official source.', google_category: byIdAll['uae-pilot-0397']?.categories||'', regions: byIdAll['uae-pilot-0397']?.regions||'', categories: byIdAll['uae-pilot-0397']?.categories||'', address: byIdAll['uae-pilot-0397']?.address||'', city: byIdAll['uae-pilot-0397']?.city||'', phone: byIdAll['uae-pilot-0397']?.phone||'', website: byIdAll['uae-pilot-0397']?.website||'', google_maps_url: byIdAll['uae-pilot-0397']?.google_maps_url||'' },
  { internal_row_id: 'uae-pilot-0306', canonical_name: 'Modern Home Engineering consultant', relevance_status: 'no_official_source_found', relevance_reason: 'Only a social-media (Instagram) link was available, no official website - insufficient for verification.', google_category: byIdAll['uae-pilot-0306']?.categories||'', regions: byIdAll['uae-pilot-0306']?.regions||'', categories: byIdAll['uae-pilot-0306']?.categories||'', address: byIdAll['uae-pilot-0306']?.address||'', city: byIdAll['uae-pilot-0306']?.city||'', phone: byIdAll['uae-pilot-0306']?.phone||'', website: byIdAll['uae-pilot-0306']?.website||'', google_maps_url: byIdAll['uae-pilot-0306']?.google_maps_url||'' },
];
const combinedRejected = existingRejected.concat(newRejectedFromDrop, rejectedFromEnrichment);
writeCsv(path.join(__dirname, 'rejected-candidates.csv'),
  ['internal_row_id','canonical_name','relevance_status','relevance_reason','google_category','regions','categories','address','city','phone','website','google_maps_url'],
  combinedRejected);
console.log('total rejected-candidates.csv rows now:', combinedRejected.length);

// --- Update manual-review-queue.csv: remove the ids that got a final enrichment status (promoted or explicitly rejected), keep the rest, add the newly-enriched needs_manual_review rows ---
const existingMRQ = loadCsv(path.join(__dirname, 'manual-review-queue.csv'));
const removedIds = new Set(Object.keys(findingsById)); // these left the "not yet enriched" pool
const remainingMRQ = existingMRQ.filter(r => !removedIds.has(r.internal_row_id));
const newMRQRows = enrichedRows.filter(r => r.review_status === 'needs_manual_review').map(r => ({
  internal_row_id: r.internal_row_id, canonical_name: r.canonical_name, relevance_status: 'eligible_employer_enriched_but_unresolved',
  reason_for_review: r.researcher_notes, google_category: r.google_category, address: r.address, city: r.city, website: r.official_website_url, google_maps_url: r.google_maps_url, batch_status: 'enriched_2026-09-07_needs_manual_review',
}));
const combinedMRQ = remainingMRQ.concat(newMRQRows);
writeCsv(path.join(__dirname, 'manual-review-queue.csv'),
  ['internal_row_id','canonical_name','relevance_status','reason_for_review','google_category','address','city','website','google_maps_url','batch_status'],
  combinedMRQ);
console.log('manual-review-queue.csv rows now:', combinedMRQ.length, '(was', existingMRQ.length, ', removed', removedIds.size, ', added', newMRQRows.length, ')');
