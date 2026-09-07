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

const dv = loadCsv(path.join(__dirname, 'deep-verification-50.csv'));
const reviewedIds = new Set(dv.map(r => r.internal_row_id));

// --- Update manual-review-queue.csv: remove the 50 reviewed ids, add back the 37 needs_more_evidence with updated reason ---
const mrq = loadCsv(path.join(__dirname, 'manual-review-queue.csv'));
console.log('mrq before:', mrq.length);
const remaining = mrq.filter(r => !reviewedIds.has(r.internal_row_id));
console.log('mrq remaining after removing the 50 reviewed:', remaining.length);

const needsMoreEvidence = dv.filter(r => r.verification_classification === 'needs_more_evidence');
const newMrqRows = needsMoreEvidence.map(r => ({
  internal_row_id: r.internal_row_id, canonical_name: r.canonical_name,
  relevance_status: 'eligible_employer_deep_verified_needs_more_evidence',
  reason_for_review: r.researcher_notes, google_category: r.sector_label, address: '', city: r.city,
  website: r.official_website_url, google_maps_url: r.google_maps_url,
  batch_status: 'deep_verified_2026-09-07_needs_more_evidence',
}));
const combinedMrq = remaining.concat(newMrqRows);
writeCsv(path.join(__dirname, 'manual-review-queue.csv'),
  ['internal_row_id','canonical_name','relevance_status','reason_for_review','google_category','address','city','website','google_maps_url','batch_status'],
  combinedMrq);
console.log('mrq after:', combinedMrq.length, '(392 - 50 + 37 =', 392-50+37, ')');

// --- Update rejected-candidates.csv: add the 1 rejected ---
const rejected = loadCsv(path.join(__dirname, 'rejected-candidates.csv'));
const newRejected = dv.filter(r => r.verification_classification === 'rejected').map(r => ({
  internal_row_id: r.internal_row_id, canonical_name: r.canonical_name, relevance_status: 'rejected_no_official_source_found',
  relevance_reason: r.researcher_notes, google_category: r.sector_label, regions: r.city, categories: r.sector_label,
  address: '', city: r.city, phone: '', website: r.official_website_url, google_maps_url: r.google_maps_url,
}));
const combinedRejected = rejected.concat(newRejected);
writeCsv(path.join(__dirname, 'rejected-candidates.csv'),
  ['internal_row_id','canonical_name','relevance_status','relevance_reason','google_category','regions','categories','address','city','phone','website','google_maps_url'],
  combinedRejected);
console.log('rejected-candidates.csv after:', combinedRejected.length, '(was', rejected.length, '+ 1)');

// --- Append the 12 new_verified into enriched-company-candidates.csv (for a single source-of-truth enrichment record) ---
const enr = loadCsv(path.join(__dirname, 'enriched-company-candidates.csv'));
const newVerified = dv.filter(r => r.verification_classification === 'new_verified');
const enrHeader = ['internal_row_id','canonical_name','relevance_status','relevance_reason','google_category','mapped_industry_guess','mapped_company_type_guess','regions','categories','address','city','country_code','phone','google_maps_url','google_place_ids','google_rating','google_reviews_count','google_supplied_website','official_website_url','website_verification_status','website_evidence_url','website_notes','verification_date','careers_source_type','careers_page_url','ats_provider_detected','careers_evidence_url','careers_notes','linkedin_company_url','linkedin_status','linkedin_evidence_url','linkedin_identity_confidence','linkedin_notes','current_open_jobs_detected','source_confidence','automation_eligibility','review_status','enrichment_batch_status','researcher_notes'];
const newEnrRows = newVerified.map(r => ({
  internal_row_id: r.internal_row_id, canonical_name: r.canonical_name, relevance_status: 'eligible_employer',
  relevance_reason: 'Selected via deterministic triage (score-based, deep-verification pass 2) and directly WebFetch-verified.',
  google_category: r.sector_label, mapped_industry_guess: r.sector_label, mapped_company_type_guess: 'private',
  regions: r.city, categories: r.sector_label, address: '', city: r.city, country_code: 'AE', phone: '',
  google_maps_url: r.google_maps_url, google_place_ids: '', google_rating: '', google_reviews_count: '',
  google_supplied_website: r.official_website_url, official_website_url: r.official_website_url,
  website_verification_status: r.website_verification_status, website_evidence_url: r.official_website_url, website_notes: r.researcher_notes,
  verification_date: r.verification_date, careers_source_type: r.careers_source_type, careers_page_url: r.careers_page_url,
  ats_provider_detected: r.ats_provider_detected, careers_evidence_url: r.careers_page_url || r.official_website_url, careers_notes: r.researcher_notes,
  linkedin_company_url: r.linkedin_usable === 'company_page_usable' ? r.linkedin_company_url : 'not_verified',
  linkedin_status: r.linkedin_usable === 'company_page_usable' ? 'verified_self_referenced' : 'not_verified',
  linkedin_evidence_url: '', linkedin_identity_confidence: r.linkedin_usable, linkedin_notes: 'LinkedIn used only as supporting identity evidence, never scraped; personal linkedin.com/in/ URLs never used.',
  current_open_jobs_detected: 'unknown', source_confidence: 'high',
  automation_eligibility: r.ats_provider_detected && r.ats_provider_detected !== 'none' && r.ats_provider_detected !== 'unknown' ? 'suitable_public_ats' : 'suitable_public_html_subject_to_review',
  review_status: 'new_verified', enrichment_batch_status: 'deep_verified_2026-09-07', researcher_notes: r.researcher_notes,
}));
writeCsv(path.join(__dirname, 'enriched-company-candidates.csv'), enrHeader, enr.concat(newEnrRows));
console.log('enriched-company-candidates.csv after:', enr.length + newEnrRows.length, '(was', enr.length, '+ 12)');
