const fs = require('fs');
const path = require('path');

const CRLF = '\r\n';
function csvField(v) {
  v = v === null || v === undefined ? '' : String(v);
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}
function writeCsv(p, header, rows) {
  const lines = [header.map(csvField).join(',')].concat(rows.map(r => header.map(h => csvField(r[h])).join(',')));
  fs.writeFileSync(p, lines.join(CRLF) + CRLF);
}
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') {}
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function normalizeDomain(url) {
  if (!url) return '';
  try {
    let u = url.trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    const parsed = new URL(u);
    let host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return host;
  } catch {
    return '';
  }
}

const LEGAL_SUFFIXES = [
  'l\\.l\\.c', 'llc', 'fz-llc', 'fze', 'fzc', 'pjsc', 'psc', 'p\\.j\\.s\\.c', 'p\\.s\\.c',
  'llp', 'l\\.l\\.p', 'ltd', 'limited', 'inc', 'incorporated', 'co\\.', 'company',
  'group', 'holding', 'holdings', 'corp', 'corporation', 'sole proprietorship',
  'trading', 'general trading', 'llc-fz', 'dmcc', 'fz'
];
function normalizeName(name) {
  if (!name) return '';
  let n = name.toLowerCase();
  n = n.replace(/[&]/g, 'and');
  n = n.replace(/[.,'’\-]/g, ' ');
  for (const suf of LEGAL_SUFFIXES) {
    const re = new RegExp('\\b' + suf + '\\b', 'g');
    n = n.replace(re, ' ');
  }
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

// --- Load raw Apify results ---
const rawDir = path.join(__dirname, 'raw');
const rawFiles = fs.readdirSync(rawDir).filter(f => f.endsWith('.json'));
const allItems = [];
for (const f of rawFiles) {
  const d = JSON.parse(fs.readFileSync(path.join(rawDir, f), 'utf8'));
  const runId = d.run_id;
  // per-item searchString already present, no separate search-term tracking needed
  for (const item of d.items) {
    allItems.push({
      run_id: runId,
      title: item.title,
      categoryName: item.categoryName,
      categories: item.categories || [],
      address: item.address,
      city: item.city,
      countryCode: item.countryCode,
      phone: item.phone,
      website: item.website,
      totalScore: item.totalScore,
      reviewsCount: item.reviewsCount,
      placeId: item.placeId,
      url: item.url,
      searchString: item.searchString,
      scrapedAt: item.scrapedAt,
      permanentlyClosed: item.permanentlyClosed,
      temporarilyClosed: item.temporarilyClosed,
    });
  }
}
console.log('total raw items loaded:', allItems.length);

// --- Group by normalized domain (preferred) else normalized name+city ---
const groups = new Map(); // key -> group
for (const item of allItems) {
  if (item.permanentlyClosed || item.temporarilyClosed) continue; // skip closed places
  const domain = normalizeDomain(item.website);
  const normName = normalizeName(item.title);
  const cityLabel = item.run_id.includes('dubai') ? 'Dubai' : 'Abu Dhabi';
  const key = domain ? 'domain:' + domain : 'name:' + normName + '|' + cityLabel;
  if (!groups.has(key)) {
    groups.set(key, {
      canonical_name: item.title,
      normalized_domain: domain,
      website: item.website || '',
      place_ids: new Set(),
      regions: new Set(),
      categories: new Set(),
      addresses: new Set(),
      cities: new Set(),
      phones: new Set(),
      ratings: [],
      reviews_counts: [],
      google_maps_urls: new Set(),
      search_terms: new Set(),
      run_ids: new Set(),
      scraped_at: item.scrapedAt,
      count: 0,
    });
  }
  const g = groups.get(key);
  g.count++;
  if (item.placeId) g.place_ids.add(item.placeId);
  g.regions.add(cityLabel);
  if (item.categoryName) g.categories.add(item.categoryName);
  if (item.address) g.addresses.add(item.address);
  if (item.city) g.cities.add(item.city);
  if (item.phone) g.phones.add(item.phone);
  if (typeof item.totalScore === 'number') g.ratings.push(item.totalScore);
  if (typeof item.reviewsCount === 'number') g.reviews_counts.push(item.reviewsCount);
  if (item.url) g.google_maps_urls.add(item.url);
  if (item.searchString) g.search_terms.add(item.searchString);
  g.run_ids.add(item.run_id);
}

console.log('unique groups after domain/name grouping:', groups.size);

// --- Load existing registries for cross-check ---
function loadRegistry(p) {
  const txt = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
  const rows = parseCSV(txt).filter(r => r.length > 1);
  const header = rows[0];
  return rows.slice(1).map(r => {
    const o = {};
    header.forEach((h, i) => o[h] = r[i]);
    return o;
  });
}
const uaeRows = loadRegistry(path.join(__dirname, '..', '..', 'uae.csv'));
const masterRows = loadRegistry(path.join(__dirname, '..', '..', 'master-company-registry.csv'));

const existingDomains = new Set();
const existingNames = new Set();
for (const r of uaeRows.concat(masterRows)) {
  const d = normalizeDomain(r.official_website_url);
  if (d) existingDomains.add(d);
  const n = normalizeName(r.company_name);
  if (n) existingNames.add(n);
}

// --- Build normalized-companies.csv ---
const normalizedRows = [];
let flaggedCount = 0;
for (const [, g] of groups) {
  const domainExisting = g.normalized_domain && existingDomains.has(g.normalized_domain);
  const nameExisting = existingNames.has(normalizeName(g.canonical_name));
  const flagged = domainExisting || nameExisting;
  if (flagged) flaggedCount++;
  const avgRating = g.ratings.length ? (g.ratings.reduce((a, b) => a + b, 0) / g.ratings.length).toFixed(1) : '';
  const totalReviews = g.reviews_counts.length ? g.reviews_counts.reduce((a, b) => a + b, 0) : '';
  normalizedRows.push({
    canonical_name: g.canonical_name,
    normalized_domain: g.normalized_domain,
    website: g.website,
    place_ids: Array.from(g.place_ids).join(';'),
    regions: Array.from(g.regions).join(';'),
    categories: Array.from(g.categories).join(';'),
    address: Array.from(g.addresses)[0] || '',
    city: Array.from(g.cities)[0] || '',
    phone: Array.from(g.phones)[0] || '',
    rating: avgRating,
    reviews_count: totalReviews,
    google_maps_url: Array.from(g.google_maps_urls)[0] || '',
    duplicate_count: g.count,
    flagged_for_review: flagged ? (domainExisting ? 'already_in_registry_domain_match' : 'already_in_registry_name_match') : '',
    source: 'apify_google_maps_' + Array.from(g.run_ids).join(';'),
    scraped_at: g.scraped_at,
  });
}

normalizedRows.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));

writeCsv(
  path.join(__dirname, 'normalized-companies.csv'),
  ['canonical_name','normalized_domain','website','place_ids','regions','categories','address','city','phone','rating','reviews_count','google_maps_url','duplicate_count','flagged_for_review','source','scraped_at'],
  normalizedRows
);

console.log('normalized rows written:', normalizedRows.length);
console.log('already-flagged (likely already in registry):', flaggedCount);
console.log('with website:', normalizedRows.filter(r => r.website).length);
console.log('without website:', normalizedRows.filter(r => !r.website).length);

// category distribution
const catCount = {};
for (const r of normalizedRows) {
  for (const c of r.categories.split(';')) {
    if (!c) continue;
    catCount[c] = (catCount[c] || 0) + 1;
  }
}
const topCats = Object.entries(catCount).sort((a,b) => b[1]-a[1]).slice(0, 30);
console.log('top categories:', JSON.stringify(topCats, null, 2));
