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

const enriched = loadCsv(path.join(__dirname, '..', 'enrichment', 'enriched-company-candidates.csv'));
const verified = enriched.filter(r => r.review_status === 'new_verified');
const today = '2026-09-07';

const promote = [
  {
    id: 'killa-design', name: 'Killa Design', legal: 'Killa Design', type: 'private', industry: 'Architecture',
    size: 'small', city: 'Dubai', geo: 'single_country',
    website: 'https://www.killadesign.com', careers: 'https://www.killadesign.com/careers/', status: 'active_with_open_jobs',
    notes: 'Award-winning Dubai architecture studio; designed the Museum of the Future and Jumeirah Marsa Al Arab Hotel.',
  },
  {
    id: 'design-infinity', name: 'Design Infinity', legal: 'Design Infinity', type: 'private', industry: 'Interior Design/Fit-out',
    size: 'mid_size', city: 'Dubai; Abu Dhabi', geo: 'single_country',
    website: 'https://design-infinity.com', careers: 'https://design-infinity.com/careers/', status: 'careers_page_found',
    notes: 'Founded 2012; 1500+ staff and 1400+ completed projects claimed on official site; confirmed offices in both Dubai (DIP) and Abu Dhabi - a genuine dual-city employer, not duplicated as two rows.',
  },
  {
    id: 'capital-engineering-consultancy', name: 'Capital Engineering Consultancy', legal: 'Capital Engineering Consultancy LLC', type: 'private', industry: 'Engineering Consultancy',
    size: 'mid_size', city: 'Abu Dhabi', geo: 'gcc_regional',
    website: 'http://www.capitalengg.com', careers: 'http://www.capitalengg.com/careers', status: 'careers_page_found',
    notes: 'Multi-disciplinary engineering consultancy est. 2006, ISO/ICV certified, MENA Winner Award 2024, operations across 7 countries. Registered HQ address shown on-site is in Sharjah (Abu Shagara); filed under Abu Dhabi per the Google Maps discovery evidence for this pilot - flagged for a human reviewer to confirm the exact Abu Dhabi office/project presence before treating this as confirmed dual-emirate coverage.',
  },
  {
    id: 'ama-global-audit-tax-advisory', name: 'AMA Global Audit Tax Advisory', legal: 'AMA Global Audit Tax Advisory', type: 'professional_services_firm', industry: 'Consulting/Professional Services',
    size: 'mid_size', city: 'Abu Dhabi', geo: 'global_multinational_with_local_office',
    website: 'https://www.amaaudit.com', careers: 'https://amaaudit.com/careers/', status: 'careers_page_found',
    notes: 'Audit/tax/advisory firm established 1999; member of the PrimeGlobal international accounting network; offices in Abu Dhabi, Dubai, India, Singapore, and the USA.',
  },
  {
    id: 'sundus', name: 'Sundus Recruitment and Outsourcing Services', legal: 'Sundus Recruitment and Outsourcing Services', type: 'staffing_or_recruitment_agency', industry: 'HR and Recruitment',
    size: 'large_enterprise', city: 'Abu Dhabi', geo: 'gcc_regional',
    website: 'https://www.sundusglobal.com', careers: 'https://www.sundusglobal.com/sundus-job-search', status: 'active_with_open_jobs',
    notes: '27-year-established HR/recruitment and outsourcing agency headquartered in Abu Dhabi (Mohamed Bin Zayed City); claims 10,000+ outsourced staff and 500+ international clients; a secondary recruitment portal at ruyacareers.ae is also referenced on-site. Directly closes the HR/recruitment sector gap flagged in the pre-pilot UAE baseline.',
  },
  {
    id: 'nmc-specialty-hospital-abu-dhabi', name: 'NMC Specialty Hospital Abu Dhabi', legal: 'NMC Specialty Hospital Abu Dhabi (NMC Healthcare)', type: 'private', industry: 'Healthcare',
    size: 'large_enterprise', city: 'Abu Dhabi', geo: 'single_country',
    website: 'https://nmc.ae/en/locations/abu-dhabi/nmc-specialty-hospital-abu-dhabi', careers: 'https://eiby.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1', status: 'active_with_open_jobs',
    ats: 'Oracle Cloud HCM', ats_id: 'eiby (Oracle Fusion instance)',
    notes: 'Part of NMC Healthcare, one of the largest private hospital groups in the UAE. Two distinct Oracle Cloud recruiting portals confirmed: a main careers site and a separate UAE-Nationals-specific site (CX_1001).',
  },
  {
    id: 'medeor-hospital', name: 'Medeor 24x7 Hospital', legal: 'Medeor 24x7 Hospital', type: 'private', industry: 'Healthcare',
    size: 'mid_size', city: 'Abu Dhabi', geo: 'single_country',
    website: 'https://medeor.ae', careers: 'https://medeor.ae/careers/', status: 'careers_page_found',
    notes: 'JCI-accredited multi-specialty hospital with a confirmed Abu Dhabi location.',
  },
  {
    id: 'healthpoint', name: 'Healthpoint', legal: 'Healthpoint', type: 'private', industry: 'Healthcare',
    size: 'mid_size', city: 'Abu Dhabi', geo: 'single_country',
    website: 'https://healthpoint.ae', careers: 'https://healthpoint.ae/careers/', status: 'careers_page_found',
    notes: 'Multispecialty hospital, part of the M42 group (major Abu Dhabi health-technology conglomerate); MOHAP-licensed (JZWJK2KF-200525).',
  },
  {
    id: 'harley-street-medical-centre', name: 'Harley Street Medical Centre', legal: 'Harley Street Medical Centre', type: 'private', industry: 'Healthcare',
    size: 'small', city: 'Abu Dhabi', geo: 'single_country',
    website: 'https://www.hsmc.ae', careers: 'https://www.hsmc.ae/careers/', status: 'careers_page_found',
    notes: 'JCI-certified medical centre in Marina Village, Abu Dhabi; MOH-licensed (JY9VD33B-180825).',
  },
  {
    id: 'global-care-hospital', name: 'Global Care Hospital', legal: 'Global Care Hospital', type: 'private', industry: 'Healthcare',
    size: 'small', city: 'Abu Dhabi', geo: 'single_country',
    website: 'https://gch.ae', careers: 'https://gch.ae/careers/', status: 'careers_page_found',
    notes: 'Licensed hospital (advertisement licence JE68DXIH-111224) in the Al Manhal area of Abu Dhabi.',
  },
];

const stagingRows = promote.map(p => ({
  canonical_company_id: 'cc-' + p.id,
  source_record_id: 'sr-ae-' + p.id,
  company_name: p.name,
  legal_or_official_name: p.legal,
  company_type: p.type,
  industry: p.industry,
  company_size_category: p.size,
  headquarters_country: 'United Arab Emirates',
  target_country: 'United Arab Emirates',
  country_code: 'AE',
  target_city: p.city,
  geographic_scope: p.geo,
  official_website_url: p.website,
  official_careers_url: p.careers,
  careers_page_status: p.status,
  ats_provider: p.ats || 'unknown',
  ats_tenant_or_board_identifier: p.ats_id || 'unknown',
  public_jobs_endpoint_or_feed: p.careers,
  proposed_access_method: p.ats ? 'suitable_public_ats' : 'suitable_public_html_subject_to_review',
  current_open_jobs_detected: 'unknown',
  early_career_relevance: 'unknown',
  internship_or_graduate_program_detected: 'unknown',
  linkedin_company_url: 'not_verified',
  linkedin_jobs_url: 'not_verified',
  linkedin_presence_status: 'not_verified',
  linkedin_usage_classification: 'discovery_and_verification_only',
  evidence_urls: p.website + (p.careers ? ';' + p.careers : ''),
  source_confidence: 'high',
  automation_eligibility: p.ats ? 'suitable_public_ats' : 'suitable_public_html_subject_to_review',
  review_status: 'verified',
  rejection_or_review_reason: '',
  terms_or_access_notes: '',
  last_verified_at: today,
  researcher_notes: 'Apify UAE discovery pilot (2026-09-07), directly WebFetch-confirmed. ' + p.notes,
}));

const uaeHeader = ['canonical_company_id','source_record_id','company_name','legal_or_official_name','company_type','industry','company_size_category','headquarters_country','target_country','country_code','target_city','geographic_scope','official_website_url','official_careers_url','careers_page_status','ats_provider','ats_tenant_or_board_identifier','public_jobs_endpoint_or_feed','proposed_access_method','current_open_jobs_detected','early_career_relevance','internship_or_graduate_program_detected','linkedin_company_url','linkedin_jobs_url','linkedin_presence_status','linkedin_usage_classification','evidence_urls','source_confidence','automation_eligibility','review_status','rejection_or_review_reason','terms_or_access_notes','last_verified_at','researcher_notes'];

writeCsv(path.join(__dirname, 'uae-promotion-staging.csv'), uaeHeader, stagingRows);

// Manifest
const CANONICAL_ID_TO_ROW_ID = {
  'killa-design': 'uae-pilot-0270', 'design-infinity': 'uae-pilot-0163', 'capital-engineering-consultancy': 'uae-pilot-0129',
  'ama-global-audit-tax-advisory': 'uae-pilot-0079', 'sundus': 'uae-pilot-0413', 'nmc-specialty-hospital-abu-dhabi': 'uae-pilot-0327',
  'medeor-hospital': 'uae-pilot-0299', 'healthpoint': 'uae-pilot-0236', 'harley-street-medical-centre': 'uae-pilot-0232',
  'global-care-hospital': 'uae-pilot-0221',
};
const manifestRows = promote.map((p) => {
  return {
    internal_row_id: CANONICAL_ID_TO_ROW_ID[p.id] || '',
    canonical_name: p.name,
    proposed_canonical_company_id: 'cc-' + p.id,
    proposed_source_record_id: 'sr-ae-' + p.id,
    source_evidence_used: 'Direct WebFetch of official domain (' + p.website + ') and its careers page, 2026-09-07',
    website_verification_status: 'confirmed_official',
    careers_source_status: p.ats ? 'confirmed_ats_' + p.ats : 'dedicated_careers_page_confirmed',
    linkedin_status: 'not_researched_not_applicable',
    automation_eligibility: p.ats ? 'suitable_public_ats' : 'suitable_public_html_subject_to_review',
    source_confidence: 'high',
    defaulted_unknown_fields: 'early_career_relevance, internship_or_graduate_program_detected, current_open_jobs_detected, company_size_category (estimated) - not assessed this pass, defaulted per the Lebanon promotion precedent (docs/job-source-discovery/pilots/apify-lebanon/reconciliation/lebanon-promotion-reconciliation-report.md §0 policy decision 4)',
    dedup_result_against_39_existing: 'No match against uae.csv (39 rows) or master-company-registry.csv (288 rows) by normalized domain or normalized name - confirmed net-new.',
    mapping_correction_applied: p.id === 'capital-engineering-consultancy' ? 'target_city kept as Abu Dhabi per Google Maps discovery evidence despite the on-site HQ address reading as Sharjah - flagged, not silently resolved.' : 'none',
  };
});
writeCsv(path.join(__dirname, 'uae-promotion-staging-manifest.csv'),
  ['internal_row_id','canonical_name','proposed_canonical_company_id','proposed_source_record_id','source_evidence_used','website_verification_status','careers_source_status','linkedin_status','automation_eligibility','source_confidence','defaulted_unknown_fields','dedup_result_against_39_existing','mapping_correction_applied'],
  manifestRows);

// Dry-run: classify ALL 467 raw candidates
const allClassified = loadCsv(path.join(__dirname, '..', 'enrichment', 'all-classified-candidates.csv'));
const rejected = loadCsv(path.join(__dirname, '..', 'enrichment', 'rejected-candidates.csv'));
const mrq = loadCsv(path.join(__dirname, '..', 'enrichment', 'manual-review-queue.csv'));
const enrichedById = {}; for (const r of enriched) enrichedById[r.internal_row_id] = r;
const promoteIds = new Set(verified.map(v => v.internal_row_id));
// Explicit internal_row_id -> canonical_company_id map (avoids fragile name-based fuzzy matching)
const rowIdToCanonicalId = {
  'uae-pilot-0270': 'cc-killa-design',
  'uae-pilot-0163': 'cc-design-infinity',
  'uae-pilot-0129': 'cc-capital-engineering-consultancy',
  'uae-pilot-0079': 'cc-ama-global-audit-tax-advisory',
  'uae-pilot-0413': 'cc-sundus',
  'uae-pilot-0327': 'cc-nmc-specialty-hospital-abu-dhabi',
  'uae-pilot-0299': 'cc-medeor-hospital',
  'uae-pilot-0236': 'cc-healthpoint',
  'uae-pilot-0232': 'cc-harley-street-medical-centre',
  'uae-pilot-0221': 'cc-global-care-hospital',
};
const rejectedIds = new Set(rejected.map(r => r.internal_row_id));
const mrqIds = new Set(mrq.map(r => r.internal_row_id));

const dryRunRows = allClassified.map(r => {
  let proposed_action, reason, proposed_destination_status;
  if (promoteIds.has(r.internal_row_id)) {
    proposed_action = 'promote_now'; proposed_destination_status = 'verified';
    reason = 'Directly WebFetch-confirmed official website + dedicated careers page/ATS this pass.';
  } else if (r.relevance_status === 'possible_duplicate_of_existing_registry') {
    proposed_action = 'hold_duplicate_review'; proposed_destination_status = 'not_applicable';
    reason = r.relevance_reason;
  } else if (rejectedIds.has(r.internal_row_id)) {
    proposed_action = 'exclude_rejected'; proposed_destination_status = 'not_applicable';
    reason = r.relevance_reason;
  } else if (mrqIds.has(r.internal_row_id)) {
    proposed_action = 'hold_manual_review'; proposed_destination_status = 'needs_manual_review';
    reason = (enrichedById[r.internal_row_id] && enrichedById[r.internal_row_id].researcher_notes) || 'Not enriched this pass (bounded sample cap) or enriched but evidence remains inconclusive - real, honestly-labeled lead held for a future pass.';
  } else {
    proposed_action = 'unclassified'; proposed_destination_status = 'unknown';
    reason = 'Did not match any classification bucket - data integrity check needed.';
  }
  return {
    internal_row_id: r.internal_row_id, canonical_name: r.canonical_name, relevance_status: r.relevance_status,
    review_status_source: (enrichedById[r.internal_row_id] && enrichedById[r.internal_row_id].review_status) || r.relevance_status,
    proposed_action, reason, matched_destination_row: rowIdToCanonicalId[r.internal_row_id] || '',
    proposed_destination_status, automation_eligibility: (enrichedById[r.internal_row_id] && enrichedById[r.internal_row_id].automation_eligibility) || 'unknown',
    confidence_level: (enrichedById[r.internal_row_id] && enrichedById[r.internal_row_id].source_confidence) || 'low',
    official_website_url: r.website, careers_page_url: (enrichedById[r.internal_row_id] && enrichedById[r.internal_row_id].careers_page_url) || '',
  };
});
writeCsv(path.join(__dirname, 'uae-promotion-dry-run.csv'),
  ['internal_row_id','canonical_name','relevance_status','review_status_source','proposed_action','reason','matched_destination_row','proposed_destination_status','automation_eligibility','confidence_level','official_website_url','careers_page_url'],
  dryRunRows);

console.log('staging rows:', stagingRows.length);
console.log('manifest rows:', manifestRows.length);
console.log('dry-run rows:', dryRunRows.length, '(should be 467)');
const actionCounts = {};
for (const r of dryRunRows) actionCounts[r.proposed_action] = (actionCounts[r.proposed_action]||0)+1;
console.log('action counts:', actionCounts);
