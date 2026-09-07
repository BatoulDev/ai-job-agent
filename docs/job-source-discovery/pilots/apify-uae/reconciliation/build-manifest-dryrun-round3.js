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

const { rows: newRows, PROFILES } = require('./build-staging-round3.js');

// Manifest additions for the 45
const manifestNew = newRows.map(r => {
  // find internal_row_id by reverse-matching slug
  const id = Object.keys(PROFILES).find(k => 'cc-' + PROFILES[k].slug === r.canonical_company_id);
  return {
    internal_row_id: id, canonical_name: r.company_name, proposed_canonical_company_id: r.canonical_company_id,
    proposed_source_record_id: r.source_record_id,
    source_evidence_used: 'Direct WebFetch of official domain (' + r.official_website_url + ') and its careers page/portal, 2026-09-07 (deep-verification pass 3, deterministic-triage batches 1-5 covering all 213 unreviewed candidates, plus round-1/round-2 revisits and no-website triage)',
    website_verification_status: 'confirmed_official', careers_source_status: r.ats_provider !== 'unknown' ? 'confirmed_ats_' + r.ats_provider : 'dedicated_careers_page_or_equivalent_confirmed',
    linkedin_status: r.linkedin_company_url !== 'not_verified' ? 'company_page_self_referenced_used_as_supporting_evidence' : 'not_found_or_not_usable',
    automation_eligibility: r.automation_eligibility, source_confidence: 'high',
    defaulted_unknown_fields: 'early_career_relevance, internship_or_graduate_program_detected, current_open_jobs_detected - not assessed this pass, defaulted per precedent',
    dedup_result_against_39_existing: 'No match against uae.csv (39 rows), master-company-registry.csv (288 rows), or the 22 previously-staged rows by normalized domain or canonical ID - confirmed net-new. Checked programmatically.',
    mapping_correction_applied: r.researcher_notes.includes('legal/trading name') || r.company_name === 'Dubai Health' || r.company_name === 'Talal Group' ? 'Company name corrected from the Google Maps discovery label to the entity\'s actual confirmed name.' : (r.target_city && r.target_city.includes(';') ? 'target_city recorded as dual/multi-city per confirmed multi-office evidence.' : 'none'),
  };
});
const existingManifest = loadCsv(path.join(__dirname, 'uae-promotion-staging-manifest.csv'));
const manifestHeader = ['internal_row_id','canonical_name','proposed_canonical_company_id','proposed_source_record_id','source_evidence_used','website_verification_status','careers_source_status','linkedin_status','automation_eligibility','source_confidence','defaulted_unknown_fields','dedup_result_against_39_existing','mapping_correction_applied'];
writeCsv(path.join(__dirname, 'uae-promotion-staging-manifest.csv'), manifestHeader, existingManifest.concat(manifestNew));
console.log('manifest total now:', existingManifest.length + manifestNew.length, '(should be 67)');

// === Rebuild full promotion dry-run (467 rows) ===
const enrDir = path.join(__dirname, '..', 'enrichment');
const allClassified = loadCsv(path.join(enrDir, 'all-classified-candidates.csv'));
const stagingAll = loadCsv(path.join(__dirname, 'uae-promotion-staging.csv'));
const rejectedAll = loadCsv(path.join(enrDir, 'rejected-candidates.csv'));
const mrqAll = loadCsv(path.join(enrDir, 'manual-review-queue.csv'));
const dupAll = loadCsv(path.join(enrDir, 'duplicate-and-alias-review.csv'));

const promoteIds = new Set(newRows.map((r,i) => Object.keys(PROFILES).find(k => 'cc-'+PROFILES[k].slug === r.canonical_company_id)));
// Also include round1+round2's originally staged 22 - reconstruct their ids from earlier manifest
const priorStagedIds = new Set(existingManifest.map(r => r.internal_row_id).filter(Boolean));
for (const id of priorStagedIds) promoteIds.add(id);

const rejectedIds = new Set(rejectedAll.map(r => r.internal_row_id));
const mrqIds = new Set(mrqAll.map(r => r.internal_row_id));
const dupIds = new Set(dupAll.flatMap(r => (r.internal_row_ids||'').split(';')));

const canonicalIdByRowId = {};
for (const r of stagingAll) { /* filled below via manifest */ }
const manifestFull = existingManifest.concat(manifestNew);
for (const m of manifestFull) canonicalIdByRowId[m.internal_row_id] = m.proposed_canonical_company_id;

const dryRunRows = allClassified.map(r => {
  let proposed_action, proposed_destination_status;
  if (promoteIds.has(r.internal_row_id)) { proposed_action = 'promote_now'; proposed_destination_status = 'verified'; }
  else if (dupIds.has(r.internal_row_id)) { proposed_action = 'hold_duplicate_review'; proposed_destination_status = 'not_applicable'; }
  else if (rejectedIds.has(r.internal_row_id)) { proposed_action = 'exclude_rejected'; proposed_destination_status = 'not_applicable'; }
  else if (mrqIds.has(r.internal_row_id)) { proposed_action = 'hold_manual_review'; proposed_destination_status = 'needs_manual_review'; }
  else { proposed_action = 'unclassified'; proposed_destination_status = 'unknown'; }
  return {
    internal_row_id: r.internal_row_id, canonical_name: r.canonical_name, relevance_status: r.relevance_status,
    review_status_source: proposed_action === 'promote_now' ? 'new_verified' : r.relevance_status,
    proposed_action, reason: proposed_action === 'promote_now' ? 'Directly WebFetch-confirmed official website + careers page/ATS/equivalent hiring channel.' : (proposed_action === 'hold_manual_review' ? 'Real, plausible candidate; evidence remains insufficient for verification (see manual-review-queue.csv for exact reason).' : (proposed_action === 'exclude_rejected' ? 'Rejected - see rejected-candidates.csv for exact reason.' : 'Held for duplicate/identity resolution - see duplicate-and-alias-review.csv.')),
    matched_destination_row: canonicalIdByRowId[r.internal_row_id] || '',
    proposed_destination_status, automation_eligibility: 'see staging/manifest', confidence_level: proposed_action === 'promote_now' ? 'high' : 'n/a',
    official_website_url: r.website, careers_page_url: '',
  };
});
writeCsv(path.join(__dirname, 'uae-promotion-dry-run.csv'),
  ['internal_row_id','canonical_name','relevance_status','review_status_source','proposed_action','reason','matched_destination_row','proposed_destination_status','automation_eligibility','confidence_level','official_website_url','careers_page_url'],
  dryRunRows);
console.log('dry-run rows:', dryRunRows.length, '(should be 467)');
const actionCounts = {}; for (const r of dryRunRows) actionCounts[r.proposed_action] = (actionCounts[r.proposed_action]||0)+1;
console.log('action counts:', actionCounts);
