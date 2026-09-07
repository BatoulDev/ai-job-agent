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

// === 1. Sanity: totals ===
console.log('213 batch findings:', all213.length);
console.log('round1 reconciliation (21):', round1recon.length);
console.log('37 revisit:', revisit37.length);
console.log('108 no-website: researched', noweb108.researched.length, 'rejected', noweb108.rejected.length, 'dup', noweb108.duplicates_of_tracked.length,
  '(covered', noweb108.researched.length + noweb108.rejected.length + noweb108.duplicates_of_tracked.length, 'of 108 individually; remainder held as needs_more_evidence unchanged)');

// === 2. Collect all NEW_VERIFIED candidates (from 213 + round1recon) ===
const newVerifiedIds = new Set();
for (const r of all213) if (r[1] === 'new_verified') newVerifiedIds.add(r[0]);
for (const r of round1recon) if (r[1] === 'new_verified') newVerifiedIds.add(r[0]);
console.log('Total NEW_VERIFIED this round:', newVerifiedIds.size);

// Build a lookup: id -> {classification, careers evidence fields...}
const findingsById = {};
for (const r of all213) findingsById[r[0]] = { source: '213', classification: r[1], careers_evidence: r[2], ats: r[3], linkedin: r[4], notes: r[5] };
for (const r of round1recon) {
  // round1recon format: [id, classification, note]
  if (!findingsById[r[0]] || r[1] === 'new_verified') {
    findingsById[r[0]] = { source: 'round1recon', classification: r[1], careers_evidence: r[1]==='new_verified' ? 'dedicated_careers_page' : 'none', ats: 'none', linkedin: '', notes: r[2] };
  }
}

writeCsv(path.join(__dirname, 'round3-new-verified-ids.csv'), ['internal_row_id'], Array.from(newVerifiedIds).map(id => ({internal_row_id: id})));
console.log('wrote round3-new-verified-ids.csv');

module.exports = { findingsById, newVerifiedIds, accById, all213, round1recon, revisit37, noweb108 };
