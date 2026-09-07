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

const b1 = require('./round3-batch1-findings.js');
const b2 = require('./round3-batch2-findings.js');
const b3 = require('./round3-batch3-findings.js');
const b4 = require('./round3-batch4-findings.js');
const b5 = require('./round3-batch5-findings.js');
const all213 = [...b1,...b2,...b3,...b4,...b5];
const round1recon = require('./round3-round1-reconciliation.js');
const revisit37 = require('./round3-37-revisit.js');
const noweb108 = require('./round3-108-nowebsite-triage.js');
const acc = loadCsv(path.join(__dirname, 'all-classified-candidates.csv'));
const accById = {}; for (const r of acc) accById[r.internal_row_id] = r;

const mrq = loadCsv(path.join(__dirname, 'manual-review-queue.csv'));
console.log('mrq before:', mrq.length);

// IDs resolved this round (any classification other than "stay as-is unchanged")
const resolvedIds = new Set();
const newRejectedRows = [];
const newDupRows = [];

// 1. The 213
for (const [id, cls, ev, ats, li, notes] of all213) {
  resolvedIds.add(id);
  if (cls === 'rejected') {
    const a = accById[id] || {};
    newRejectedRows.push({ internal_row_id: id, canonical_name: a.canonical_name || id, relevance_status: 'rejected_individual_practitioner',
      relevance_reason: notes, google_category: a.categories||'', regions: a.regions||'', categories: a.categories||'', address: a.address||'', city: a.regions||'', phone: a.phone||'', website: a.website||'', google_maps_url: a.google_maps_url||'' });
  }
}

// 2. The 37 revisit - all stay needs_more_evidence except uae-pilot-0351 which got a resolved-negative finding (still needs_more_evidence but not "unresolved technical", a confirmed real+no-careers finding) - no change to classification, just reason update. None removed from mrq via this loop (handled by newMrqFromRevisit below).

// 3. Round1 21 - resolved (either flip to verified/staged, or stay - all leave "eligible_employer_enriched_but_unresolved" state)
for (const [id, cls, note] of round1recon) {
  resolvedIds.add(id);
}

// 4. No-website 108 - only the 12 individually-researched ones are resolved
for (const [id, cls, notes] of noweb108.researched) {
  resolvedIds.add(id);
  if (cls === 'duplicate_or_branch') {
    const a = accById[id] || {};
    newDupRows.push({ review_type: 'duplicate_branch_absorbed_or_same_facility', candidate_a: id, candidate_b: '(see evidence)', evidence: notes, resolution: 'held_as_duplicate_not_promoted', internal_row_ids: id });
  }
}
for (const [id, reason] of noweb108.rejected) {
  resolvedIds.add(id);
  const a = accById[id] || {};
  newRejectedRows.push({ internal_row_id: id, canonical_name: a.canonical_name || id, relevance_status: 'rejected_individual_practitioner',
    relevance_reason: reason, google_category: a.categories||'', regions: a.regions||'', categories: a.categories||'', address: a.address||'', city: a.regions||'', phone: a.phone||'', website: a.website||'', google_maps_url: a.google_maps_url||'' });
}
for (const [id, matchedId, reason] of noweb108.duplicates_of_tracked) {
  resolvedIds.add(id);
  newDupRows.push({ review_type: 'duplicate_branch_of_tracked_candidate', candidate_a: id, candidate_b: matchedId, evidence: reason, resolution: 'held_as_duplicate_not_promoted', internal_row_ids: id + ';' + matchedId });
}

console.log('total resolved ids this round:', resolvedIds.size);

// New_verified ids get removed from mrq entirely (now staged)
const newVerifiedIds = new Set();
for (const [id, cls] of all213) if (cls === 'new_verified') newVerifiedIds.add(id);
for (const [id, cls] of round1recon) if (cls === 'new_verified') newVerifiedIds.add(id);

// Build remaining mrq: drop all resolved ids EXCEPT keep needs_more_evidence/low_priority ones back in (with updated status label)
const remaining = mrq.filter(r => !resolvedIds.has(r.internal_row_id));
console.log('mrq remaining (untouched this round):', remaining.length);

const findingsById213 = {}; for (const [id, cls, ev, ats, li, notes] of all213) findingsById213[id] = { cls, notes };
const newMrqFrom213 = [];
for (const [id, cls, ev, ats, li, notes] of all213) {
  if (cls === 'needs_more_evidence' || cls === 'low_priority') {
    const a = accById[id] || {};
    newMrqFrom213.push({ internal_row_id: id, canonical_name: a.canonical_name || id, relevance_status: 'deep_reviewed_round3_' + cls,
      reason_for_review: notes, google_category: a.categories||'', address: a.address||'', city: a.regions||'', website: a.website||'', google_maps_url: a.google_maps_url||'', batch_status: 'round3_batch_reviewed_2026-09-07' });
  }
}

const round1reconById = {}; for (const [id, cls, note] of round1recon) round1reconById[id] = note;
const newMrqFromRound1 = round1recon.filter(([id,cls]) => cls !== 'new_verified').map(([id, cls, note]) => {
  const a = accById[id] || {};
  return { internal_row_id: id, canonical_name: a.canonical_name || id, relevance_status: 'round1_reconciled_needs_more_evidence',
    reason_for_review: note, google_category: a.categories||'', address: a.address||'', city: a.regions||'', website: a.website||'', google_maps_url: a.google_maps_url||'', batch_status: 'round3_reconciled_2026-09-07' };
});

const newMrqFromNoweb = noweb108.researched.filter(([id,cls])=>cls==='needs_more_evidence').map(([id,cls,notes]) => {
  const a = accById[id] || {};
  return { internal_row_id: id, canonical_name: a.canonical_name || id, relevance_status: 'nowebsite_researched_needs_more_evidence',
    reason_for_review: notes, google_category: a.categories||'', address: a.address||'', city: a.regions||'', website: a.website||'', google_maps_url: a.google_maps_url||'', batch_status: 'round3_researched_2026-09-07' };
});

// Note: the "duplicate_or_branch" classified no-website rows (Mafraq, SKMC) and the round1's 1 verified do not go back into mrq.

const combinedMrq = remaining.concat(newMrqFrom213, newMrqFromRound1, newMrqFromNoweb);
writeCsv(path.join(__dirname, 'manual-review-queue.csv'),
  ['internal_row_id','canonical_name','relevance_status','reason_for_review','google_category','address','city','website','google_maps_url','batch_status'],
  combinedMrq);
console.log('mrq after:', combinedMrq.length);

// Update rejected-candidates.csv
const rejected = loadCsv(path.join(__dirname, 'rejected-candidates.csv'));
const combinedRejected = rejected.concat(newRejectedRows);
writeCsv(path.join(__dirname, 'rejected-candidates.csv'),
  ['internal_row_id','canonical_name','relevance_status','relevance_reason','google_category','regions','categories','address','city','phone','website','google_maps_url'],
  combinedRejected);
console.log('rejected after:', combinedRejected.length, '(+' + newRejectedRows.length + ')');

// Update duplicate-and-alias-review.csv
const dupReview = loadCsv(path.join(__dirname, 'duplicate-and-alias-review.csv'));
const combinedDup = dupReview.concat(newDupRows);
writeCsv(path.join(__dirname, 'duplicate-and-alias-review.csv'),
  ['review_type','candidate_a','candidate_b','evidence','resolution','internal_row_ids'],
  combinedDup);
console.log('dup-review after:', combinedDup.length, '(+' + newDupRows.length + ')');

// Sanity: full pool accounting (467 total)
const stagingR3 = loadCsv(path.join(__dirname, '..', 'reconciliation', 'uae-promotion-staging.csv'));
console.log('=== FULL POOL ACCOUNTING ===');
console.log('staging (total):', stagingR3.length);
console.log('mrq (backlog):', combinedMrq.length);
console.log('rejected:', combinedRejected.length);
console.log('dup-review:', combinedDup.length);
console.log('SUM:', stagingR3.length + combinedMrq.length + combinedRejected.length + combinedDup.length, 'vs 467');
