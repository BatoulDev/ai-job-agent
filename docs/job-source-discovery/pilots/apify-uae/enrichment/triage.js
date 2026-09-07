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

const mrq = loadCsv(path.join(__dirname, 'manual-review-queue.csv'));
const acc = loadCsv(path.join(__dirname, 'all-classified-candidates.csv'));
const enr = loadCsv(path.join(__dirname, 'enriched-company-candidates.csv'));
const accById = {}; for (const r of acc) accById[r.internal_row_id] = r;
const enrById = {}; for (const r of enr) enrById[r.internal_row_id] = r;

console.log('mrq', mrq.length, 'acc', acc.length, 'enr', enr.length);

const WEAK_PLATFORM_DOMAINS = ['instagram.com','facebook.com','wa.me','linktr.ee','wixsite.com','weebly.com','godaddysites.com','business.site','blogspot.com','sites.google.com','wa.link','m.me','x.com','twitter.com'];
const PERSON_TITLE_RE = /^(dr\.?|mr\.?|mrs\.?|ms\.?|eng\.?|er\.?|prof\.?)\s/i;
const PERSON_CATEGORIES = new Set(['Surgeon','Dentist','Doctor','Physician','Lawyer','Accountant']);
const COMPANY_SIGNAL_RE = /(llc|l\.l\.c|fz-llc|fze|pjsc|group|company|co\.|consultanc|consultants?|contracting|engineering|design|studio|firm|est\.|establishment|trading|services?|solutions?|international|associates|center|centre|clinic|hospital|medical|holding|enterprises?|corp)/i;
const BRANCH_QUALIFIER_RE = /(\s-\s[A-Za-z؀-ۿ ]+$|\bbranch\b|\bbr\.\b)/i;

const CONSTRUCTION_CATS = new Set(['Construction company','Contractor','General contractor','Home builder','Road construction company','Interior construction contractor','Interior fitting contractor','Building firm','Marble contractor']);
const ENGINEERING_CATS = new Set(['Engineering consultant','Building consultant','Structural engineer','Engineer','Lighting consultant']);
const ARCHITECTURE_CATS = new Set(['Architecture firm','Architect','Architectural designer','Interior architect office']);
const ACCOUNTING_CATS = new Set(['Accounting firm','Auditor','Certified public accountant','Chartered accountant','Tax consultant','Tax preparation','Business management consultant','Accountant']);
const HEALTHCARE_CATS = new Set(['Hospital','Medical Center','Medical clinic','General hospital','Maternity hospital','Military hospital','Urgent care center','Dental clinic']);
const DESIGN_CATS = new Set(['Interior designer','Interior Decorator','Landscape designer']);
const LOGISTICS_CATS = new Set(['Logistics service','Freight forwarding service','Shipping service','Mover']);
const HR_CATS = new Set(['Recruiter','Employment agency','Staffing agency','HR consultant']);
const NGO_CATS = new Set(['Non-profit organization','NGO','Charity']);
const SCHOOL_CATS = new Set(['School','Private school','Primary school','Secondary school']);
const MARKETING_CATS = new Set(['Marketing agency','Advertising agency','Graphic designer']);

function sectorScore(categories) {
  const cats = categories.split(';').map(c=>c.trim()).filter(Boolean);
  for (const c of cats) if (CONSTRUCTION_CATS.has(c)) return [25, 'Construction'];
  for (const c of cats) if (ENGINEERING_CATS.has(c)) return [25, 'Engineering'];
  for (const c of cats) if (ARCHITECTURE_CATS.has(c)) return [25, 'Architecture'];
  for (const c of cats) if (HR_CATS.has(c)) return [25, 'HR and Recruitment'];
  for (const c of cats) if (NGO_CATS.has(c)) return [25, 'NGO'];
  for (const c of cats) if (SCHOOL_CATS.has(c)) return [25, 'Schools/Education'];
  for (const c of cats) if (ACCOUNTING_CATS.has(c)) return [22, 'Accounting/Audit'];
  for (const c of cats) if (HEALTHCARE_CATS.has(c)) return [22, 'Healthcare'];
  for (const c of cats) if (MARKETING_CATS.has(c)) return [22, 'Marketing/Design'];
  for (const c of cats) if (DESIGN_CATS.has(c)) return [18, 'Interior Design (secondary)'];
  for (const c of cats) if (c === 'Real estate developer') return [18, 'Construction/Real Estate (secondary)'];
  for (const c of cats) if (LOGISTICS_CATS.has(c)) return [12, 'Logistics (secondary)'];
  return [8, 'Other'];
}

function scaleScore(reviewsCount, rating) {
  const rc = parseFloat(reviewsCount) || 0;
  let s = 0;
  if (rc >= 150) s = 18; else if (rc >= 50) s = 14; else if (rc >= 10) s = 9; else if (rc >= 1) s = 4; else s = 0;
  const r = parseFloat(rating) || 0;
  if (r >= 4.5) s += 2; else if (r >= 4.0) s += 1;
  return Math.min(s, 20);
}

function domainScore(website) {
  if (!website) return { score: 0, tier: 'no_website' };
  let host = '';
  try { let u = website.trim(); if (!/^https?:\/\//i.test(u)) u = 'https://'+u; host = new URL(u).hostname.toLowerCase().replace(/^www\./,''); } catch { return { score: 3, tier: 'unparseable_url' }; }
  if (WEAK_PLATFORM_DOMAINS.some(d => host.includes(d))) return { score: 5, tier: 'weak_social_platform' };
  if (host.endsWith('.ae')) return { score: 25, tier: 'ae_domain' };
  return { score: 15, tier: 'generic_domain' };
}

const rows = [];
let hardRejectCount = 0;

for (const r of mrq) {
  const a = accById[r.internal_row_id] || {};
  const e = enrById[r.internal_row_id];
  const categories = a.categories || r.google_category || '';
  const regions = a.regions || '';
  const website = a.website || r.website || '';
  const name = r.canonical_name || '';

  // --- Hard reject checks ---
  let hardReject = null;
  if (regions && regions !== 'Dubai' && regions !== 'Abu Dhabi') hardReject = 'outside_dubai_abu_dhabi';
  if (!hardReject && PERSON_TITLE_RE.test(name)) hardReject = 'individual_practitioner_name_pattern';
  if (!hardReject) {
    const cats = categories.split(';').map(c=>c.trim());
    const hasPersonCat = cats.some(c => PERSON_CATEGORIES.has(c));
    if (hasPersonCat && !COMPANY_SIGNAL_RE.test(name)) hardReject = 'individual_practitioner_category_and_name';
  }

  const dom = domainScore(website);
  const [secScore, secLabel] = sectorScore(categories);
  const scl = scaleScore(a.reviews_count, a.rating);
  const cityScore = (regions === 'Dubai' || regions === 'Abu Dhabi') ? 10 : 0;

  let dupAdj = 0;
  let dupReason = '';
  if (BRANCH_QUALIFIER_RE.test(name)) { dupAdj -= 10; dupReason = 'branch_qualifier_in_name'; }
  else if (parseFloat(a.duplicate_count) >= 2) { dupAdj += 5; dupReason = 'corroborated_across_multiple_search_hits'; }

  let identityPenalty = 0;
  let identityReason = '';
  if (!hardReject) {
    const wordCount = name.trim().split(/\s+/).length;
    if (wordCount <= 2 && !COMPANY_SIGNAL_RE.test(name) && (categories === 'Store' || categories === 'Consultant')) {
      identityPenalty = -10; identityReason = 'generic_short_name_no_company_signal';
    }
  }

  let enrichmentBonus = 0;
  let enrichmentNote = '';
  if (e) {
    if (e.website_verification_status === 'confirmed_official') { enrichmentBonus = 15; enrichmentNote = 'already_confirmed_official_domain_in_prior_pass'; }
    else if (e.website_verification_status === 'blocked_technical') { enrichmentBonus = 5; enrichmentNote = 'prior_pass_technical_block_worth_retry'; }
  }

  let score = dom.score + cityScore + secScore + scl + dupAdj + identityPenalty + enrichmentBonus;
  score = Math.max(0, Math.min(100, score));

  let bucket;
  if (hardReject) { bucket = 'reject'; hardRejectCount++; }
  else if (score < 15) bucket = 'reject';
  else if (score < 35) bucket = 'low_priority';
  else if (score < 55) bucket = 'medium_priority_backlog';
  else bucket = 'high_priority_verification';

  rows.push({
    internal_row_id: r.internal_row_id,
    canonical_name: name,
    score,
    bucket,
    hard_reject_reason: hardReject || '',
    city: regions,
    sector_label: secLabel,
    sector_score: secScore,
    domain_tier: dom.tier,
    domain_score: dom.score,
    scale_score: scl,
    reviews_count: a.reviews_count || '',
    rating: a.rating || '',
    duplicate_adjustment: dupAdj,
    duplicate_reason: dupReason,
    identity_penalty: identityPenalty,
    identity_reason: identityReason,
    enrichment_bonus: enrichmentBonus,
    enrichment_note: enrichmentNote,
    website: website,
    normalized_domain: a.normalized_domain || '',
    address: a.address || '',
    google_category: categories,
    relevance_status: r.relevance_status,
    already_enriched: e ? 'yes' : 'no',
    google_maps_url: a.google_maps_url || r.google_maps_url || '',
  });
}

rows.sort((a, b) => b.score - a.score);

const bucketCounts = {};
for (const r of rows) bucketCounts[r.bucket] = (bucketCounts[r.bucket]||0)+1;
console.log('bucket counts:', bucketCounts);
console.log('hard rejects within reject bucket:', hardRejectCount);

writeCsv(path.join(__dirname, 'triage-scored-candidates.csv'),
  ['internal_row_id','canonical_name','score','bucket','hard_reject_reason','city','sector_label','sector_score','domain_tier','domain_score','scale_score','reviews_count','rating','duplicate_adjustment','duplicate_reason','identity_penalty','identity_reason','enrichment_bonus','enrichment_note','website','normalized_domain','address','google_category','relevance_status','already_enriched','google_maps_url'],
  rows);

// City breakdown within high_priority
const high = rows.filter(r => r.bucket === 'high_priority_verification');
const highByCity = {}; for (const r of high) highByCity[r.city] = (highByCity[r.city]||0)+1;
console.log('high_priority total:', high.length, 'by city:', highByCity);
const highBySector = {}; for (const r of high) highBySector[r.sector_label] = (highBySector[r.sector_label]||0)+1;
console.log('high_priority by sector:', highBySector);
