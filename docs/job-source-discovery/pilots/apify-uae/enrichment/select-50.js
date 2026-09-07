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

const t = loadCsv(path.join(__dirname, 'triage-scored-candidates.csv'));
const netNewHigh = t.filter(x => x.bucket === 'high_priority_verification' && x.already_enriched === 'no');

const cellTargets = {
  'Construction|Dubai': 6, 'Architecture|Dubai': 6, 'Engineering|Dubai': 6, 'Accounting/Audit|Dubai': 5, 'Healthcare|Dubai': 5,
  'Healthcare|Abu Dhabi': 5, 'Construction|Abu Dhabi': 5, 'Engineering|Abu Dhabi': 5, 'Accounting/Audit|Abu Dhabi': 5, 'Architecture|Abu Dhabi': 2,
};

const byCell = {};
for (const r of netNewHigh) {
  const k = r.sector_label + '|' + r.city;
  if (!byCell[k]) byCell[k] = [];
  byCell[k].push(r);
}
for (const k in byCell) byCell[k].sort((a, b) => b.score - a.score);

const selected = [];
for (const [cell, target] of Object.entries(cellTargets)) {
  const pool = byCell[cell] || [];
  selected.push(...pool.slice(0, target));
}

console.log('selected total:', selected.length);
const byCity = {}; for (const r of selected) byCity[r.city] = (byCity[r.city]||0)+1;
console.log('by city:', byCity);
const bySector = {}; for (const r of selected) bySector[r.sector_label] = (bySector[r.sector_label]||0)+1;
console.log('by sector:', bySector);

writeCsv(path.join(__dirname, 'selected-50-for-deep-verification.csv'),
  ['internal_row_id','canonical_name','score','city','sector_label','domain_tier','website','normalized_domain','address','google_category','google_maps_url','reviews_count','rating'],
  selected);
