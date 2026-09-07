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
    else { if(c==='"') inQ=true; else if(c===',' ){row.push(field);field='';} else if(c==='\n'){row.push(field);rows.push(row);row=[];field='';} else if(c==='\r'){} else field+=c; }
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

const IRRELEVANT_CATEGORIES = new Set([
  'Electronics store','Carpet store','Fruit and vegetable store','Computer store',
  'Corporate office', // too generic/ambiguous, not itself an identifiable employer
]);

const data = loadCsv(path.join(__dirname, 'normalized-companies.csv'));
console.log('loaded', data.length);

let rowId = 1;
const classified = data.map(r => {
  const cats = r.categories.split(';').filter(Boolean);
  const isIrrelevant = cats.length > 0 && cats.every(c => IRRELEVANT_CATEGORIES.has(c));
  const alreadyFlagged = !!r.flagged_for_review;
  let relevance_status, relevance_reason;
  if (alreadyFlagged) {
    relevance_status = 'possible_duplicate_of_existing_registry';
    relevance_reason = r.flagged_for_review;
  } else if (isIrrelevant) {
    relevance_status = 'irrelevant_small_retail_or_generic';
    relevance_reason = 'Category set (' + cats.join(', ') + ') indicates a small single-location retail/generic listing, not a genuine mid/large employer target for this project.';
  } else if (!r.website) {
    relevance_status = 'eligible_employer_no_website';
    relevance_reason = 'Category plausible as a real employer but Google Maps returned no website field - cannot verify an official source without one.';
  } else {
    relevance_status = 'eligible_employer';
    relevance_reason = 'Category (' + cats.join(', ') + ') is a plausible genuine employer sector matching the task\'s target sectors, and a website is present for verification.';
  }
  return Object.assign({}, r, {
    internal_row_id: 'uae-pilot-' + String(rowId++).padStart(4, '0'),
    relevance_status,
    relevance_reason,
  });
});

const counts = {};
for (const r of classified) counts[r.relevance_status] = (counts[r.relevance_status]||0)+1;
console.log('relevance counts', counts);

// Save rejected (irrelevant) candidates in Lebanon-matching schema
const rejected = classified.filter(r => r.relevance_status === 'irrelevant_small_retail_or_generic');
writeCsv(path.join(__dirname, 'enrichment', 'rejected-candidates.csv'),
  ['internal_row_id','canonical_name','relevance_status','relevance_reason','google_category','regions','categories','address','city','phone','website','google_maps_url'],
  rejected.map(r => ({ internal_row_id: r.internal_row_id, canonical_name: r.canonical_name, relevance_status: r.relevance_status, relevance_reason: r.relevance_reason, google_category: r.categories, regions: r.regions, categories: r.categories, address: r.address, city: r.city, phone: r.phone, website: r.website, google_maps_url: r.google_maps_url }))
);

// Save the possible-duplicate-of-existing-registry row(s) into duplicate-and-alias-review.csv
const dupes = classified.filter(r => r.relevance_status === 'possible_duplicate_of_existing_registry');
writeCsv(path.join(__dirname, 'enrichment', 'duplicate-and-alias-review.csv'),
  ['review_type','candidate_a','candidate_b','evidence','resolution','internal_row_ids'],
  dupes.map(r => ({ review_type: 'possible_duplicate_of_existing_uae_registry_row', candidate_a: r.canonical_name, candidate_b: '(existing uae.csv/master-company-registry.csv row)', evidence: r.relevance_reason + ' | domain=' + r.normalized_domain, resolution: 'held_pending_manual_confirmation_not_promoted', internal_row_ids: r.internal_row_id }))
);

// Full classified candidate list saved for traceability (all 467)
writeCsv(path.join(__dirname, 'enrichment', 'all-classified-candidates.csv'),
  ['internal_row_id','canonical_name','relevance_status','relevance_reason','normalized_domain','website','regions','categories','address','city','phone','rating','reviews_count','google_maps_url','place_ids','duplicate_count','source','scraped_at'],
  classified
);

// --- Selection for full enrichment: eligible_employer only, ranked, capped per sector-cluster x city ---
const CATEGORY_TO_CLUSTER = {
  'Construction company': 'g3_construction_accounting_logistics', 'Contractor': 'g3_construction_accounting_logistics',
  'General contractor': 'g3_construction_accounting_logistics', 'Home builder': 'g3_construction_accounting_logistics',
  'Road construction company': 'g3_construction_accounting_logistics', 'Building consultant': 'g3_construction_accounting_logistics',
  'Accounting firm': 'g3_construction_accounting_logistics', 'Auditor': 'g3_construction_accounting_logistics',
  'Certified public accountant': 'g3_construction_accounting_logistics', 'Chartered accountant': 'g3_construction_accounting_logistics',
  'Logistics service': 'g3_construction_accounting_logistics', 'Freight forwarding service': 'g3_construction_accounting_logistics',
  'Shipping service': 'g3_construction_accounting_logistics',
  'Hospital': 'g4_retail_hospitality_healthcare', 'General hospital': 'g4_retail_hospitality_healthcare',
  'Medical Center': 'g4_retail_hospitality_healthcare', 'Medical clinic': 'g4_retail_hospitality_healthcare',
  'Engineering consultant': 'g1_engineering_architecture_design', 'Architecture firm': 'g1_engineering_architecture_design',
  'Architect': 'g1_engineering_architecture_design', 'Architectural designer': 'g1_engineering_architecture_design',
  'Interior designer': 'g1_engineering_architecture_design', 'Interior Decorator': 'g1_engineering_architecture_design',
  'Landscape designer': 'g1_engineering_architecture_design', 'Consultant': 'g1_engineering_architecture_design',
};

const eligible = classified.filter(r => r.relevance_status === 'eligible_employer');
for (const r of eligible) {
  const cats = r.categories.split(';').filter(Boolean);
  let cluster = 'other';
  for (const c of cats) { if (CATEGORY_TO_CLUSTER[c]) { cluster = CATEGORY_TO_CLUSTER[c]; break; } }
  r._cluster = cluster;
  r._city = r.regions.includes('Dubai') && r.regions.includes('Abu Dhabi') ? 'Both' : (r.regions.includes('Dubai') ? 'Dubai' : 'Abu Dhabi');
  r._score = (parseFloat(r.reviews_count) || 0) * 1 + (parseFloat(r.rating) || 0) * 10;
}

// Rank within each (cluster, city) cell, take top N
const CAP_PER_CELL = 6;
const cells = new Map();
for (const r of eligible) {
  const key = r._cluster + '|' + r._city;
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push(r);
}
const selected = [];
for (const [, arr] of cells) {
  arr.sort((a, b) => b._score - a._score);
  selected.push(...arr.slice(0, CAP_PER_CELL));
}
console.log('cells:', cells.size, 'selected for full enrichment:', selected.length);
console.log('cell breakdown:', Array.from(cells.entries()).map(([k,v]) => k + ':' + v.length));

writeCsv(path.join(__dirname, 'enrichment', 'selected-for-enrichment.csv'),
  ['internal_row_id','canonical_name','_cluster','_city','website','normalized_domain','categories','rating','reviews_count','address','phone','google_maps_url'],
  selected.map(r => ({ internal_row_id: r.internal_row_id, canonical_name: r.canonical_name, _cluster: r._cluster, _city: r._city, website: r.website, normalized_domain: r.normalized_domain, categories: r.categories, rating: r.rating, reviews_count: r.reviews_count, address: r.address, phone: r.phone, google_maps_url: r.google_maps_url }))
);

// Remaining eligible-but-not-selected + no-website: manual review queue (not enriched this pass, but real leads)
const notSelectedIds = new Set(selected.map(r => r.internal_row_id));
const manualReview = classified.filter(r =>
  (r.relevance_status === 'eligible_employer' && !notSelectedIds.has(r.internal_row_id)) ||
  r.relevance_status === 'eligible_employer_no_website'
);
writeCsv(path.join(__dirname, 'enrichment', 'manual-review-queue.csv'),
  ['internal_row_id','canonical_name','relevance_status','reason_for_review','google_category','address','city','website','google_maps_url','batch_status'],
  manualReview.map(r => ({ internal_row_id: r.internal_row_id, canonical_name: r.canonical_name, relevance_status: r.relevance_status, reason_for_review: r.relevance_status === 'eligible_employer_no_website' ? 'No website field returned by Google Maps - cannot verify an official source.' : 'Plausible real employer but not selected for this pass\'s bounded enrichment sample (capped at ' + CAP_PER_CELL + ' per sector-cluster x city cell, ranked by review count/rating); a genuine, honestly-labeled lead awaiting a future enrichment pass.', google_category: r.categories, address: r.address, city: r.city, website: r.website, google_maps_url: r.google_maps_url, batch_status: 'not_enriched_this_pass' }))
);

console.log('manual review queue size:', manualReview.length);
console.log('rejected size:', rejected.length);
console.log('duplicate-flagged size:', dupes.length);
console.log('SANITY total = selected + manualReview + rejected + dupes:', selected.length + manualReview.length + rejected.length + dupes.length, 'vs classified', classified.length);
