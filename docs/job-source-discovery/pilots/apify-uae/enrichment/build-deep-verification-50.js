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

const selected = loadCsv(path.join(__dirname, 'selected-50-for-deep-verification.csv'));
const byId = {}; for (const r of selected) byId[r.internal_row_id] = r;

// [id, verification_classification, website_status, careers_status, careers_url, ats, linkedin_url, linkedin_usable, notes]
const F = [
  ['uae-pilot-0100','new_verified','confirmed_official','dedicated_careers_page','https://www.assistplus.ae/careers','unknown','https://www.linkedin.com/company/assist-plus-accounting-and-auditing-services/','company_page_usable','Accounting/audit firm regulated by UAE Ministry of Economy, DIFC, FTA. Site states it is "An Assist Plus Group Company" with a separate Subsidiaries menu - flagged as a group structure, not a blocker. Offices in Abu Dhabi (HQ), Dubai, Sharjah.'],
  ['uae-pilot-0018','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','https://www.linkedin.com/company/105158793 (unverified slug, numeric id only)','not_confirmed','Real independent accounting firm, Abu Dhabi. No careers page found.'],
  ['uae-pilot-0434','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','[personal LinkedIn profile URL - redacted, not used as evidence per policy]','personal_profile_not_usable','Real independent firm (LLC OPC), Abu Dhabi, 15+ yrs claimed. Only a personal LinkedIn profile self-referenced - not usable per policy (company pages only). No careers page.'],
  ['uae-pilot-0450','needs_more_evidence','blocked_technical','not_confirmed_this_pass','','unknown','','not_confirmed','Two fetch attempts returned only a page title ("Business Consulting & Advisory Services UAE | Yemnak"), no substantive content - likely a JS-rendered page. Needs a manual browser check.'],
  ['uae-pilot-0458','needs_more_evidence','blocked_technical','not_confirmed_this_pass','','unknown','','not_confirmed','Two fetch attempts returned only a page title ("Zero Accounting — Dubai & Abu Dhabi Auditing and Accounting Firm"), no substantive content - likely a JS-rendered page. Needs a manual browser check.'],
  ['uae-pilot-0156','new_verified','confirmed_official','dedicated_careers_page','https://darjiaccounting.ae/careers/','unknown','[personal LinkedIn profile URL - redacted, not used as evidence per policy]','personal_profile_not_usable_but_careers_page_sufficient','Independent accounting firm, Dubai + London offices, 25+ yrs collective experience. Careers page directly confirmed. Self-referenced LinkedIn is the founder\'s personal profile (not used per policy) but the dedicated careers page alone is sufficient evidence.'],
  ['uae-pilot-0112','new_verified','confirmed_official','dedicated_careers_page','https://bericht.ae/Career','unknown','https://www.linkedin.com/company/bericht-audit-advisory/','company_page_usable','Independent audit/advisory firm est. 2014, 50+ staff claimed, DDA/DMCC-approved auditor, PrimeGlobal member. Careers link confirmed in site footer; sub-page content not independently rendered this pass.'],
  ['uae-pilot-0230','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','','not_confirmed','Real independent firm (also UK-based), Dubai branch, ACCA/AAT affiliated. No careers page or LinkedIn self-reference found.'],
  ['uae-pilot-0052','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','referenced generically, no direct URL captured','not_confirmed','Real independent business-advisory firm, two Dubai offices. No careers page found; LinkedIn mentioned only in body text, no direct URL captured.'],
  ['uae-pilot-0083','needs_more_evidence','blocked_technical','not_confirmed_this_pass','','unknown','','not_confirmed','Two fetch attempts (homepage + /about-us, which 404d) returned only a page title, no substantive content. Needs a manual browser check.'],

  ['uae-pilot-0416','needs_more_evidence','blocked_technical','not_confirmed_this_pass','','unknown','','not_confirmed','SSL error (TLSV1_ALERT_INTERNAL_ERROR) on fetch - could not verify content this pass. Needs a manual browser check or retry.'],
  ['uae-pilot-0324','needs_more_evidence','confirmed_official_weak_domain','none_found_general_contact_only','','none','','not_confirmed','Real firm claiming operation since 2010 (Abu Dhabi + Dubai), but hosted on a personal Vercel subdomain (next-architects.vercel.app) rather than a custom domain - a real domain-quality red flag for an allegedly 14-year-old firm, downgraded accordingly. No careers page.'],
  ['uae-pilot-0341','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','https://linkedin.com/company/opd-architectural-consultant/','company_page_exists_but_no_careers_evidence','Independent architecture/interior design firm, two Dubai offices. Has a company LinkedIn page but no careers page or hiring email found.'],
  ['uae-pilot-0137','new_verified','confirmed_official','dedicated_careers_page','https://www.chawladxb.ae/careers (nav link observed, sub-page not independently rendered)','unknown','company LinkedIn referenced in nav (URL pattern only, not independently confirmed)','not_confirmed','Independent firm founded 1976 (48+ yrs), Dubai, unlimited license, 2800+ projects claimed. "Careers" link directly observed in site navigation.'],
  ['uae-pilot-0231','needs_more_evidence','weak_evidence','none_found_general_contact_only','','none','','not_confirmed','Minimal verifiable content - no team info, credentials, or careers/LinkedIn found. Real UAE presence not strongly confirmed beyond marketing copy.'],
  ['uae-pilot-0235','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','[personal LinkedIn profile URL - redacted, not used as evidence per policy]','personal_profile_not_usable','Real but young independent firm (founded 2023), Dubai, led by a named civil engineer. No careers page; only the founder\'s personal LinkedIn profile found (not usable per policy).'],
  ['uae-pilot-0091','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','https://linkedin.com/company/arkiplandubai/','company_page_exists_but_no_careers_evidence','Independent firm founded 2005, Dubai, 217+ projects/75+ staff claimed. Has company LinkedIn but no careers page found.'],
  ['uae-pilot-0152','needs_more_evidence','blocked_technical','not_confirmed_this_pass','','unknown','','not_confirmed','HTTP 401 Unauthorized on fetch - could not verify content or confirm whether this is an architecture firm or a specialty demolition/core-cutting contractor (name suggests the latter). Needs a manual browser check.'],

  ['uae-pilot-0352','needs_more_evidence','blocked_technical','not_confirmed_this_pass','','unknown','','not_confirmed','Two fetch attempts (homepage empty content, /about 404d) - could not verify. Needs a manual browser check.'],
  ['uae-pilot-0141','new_verified','confirmed_official','dedicated_careers_page','careers/vacancies section (exact URL path not itemized in fetched excerpt)','unknown','none found this pass','not_confirmed','Independent civil engineering/contracting firm founded 1974, Abu Dhabi, 4,000+ staff claimed - one of the largest candidates in this pass. Dedicated "VACANCIES" and "APPLY FORM" pages directly confirmed.'],
  ['uae-pilot-0396','new_verified','confirmed_official','dedicated_careers_page','https://silvercoast.ae/join-us/','unknown','company LinkedIn referenced ("Connect with us" link, URL not directly captured)','not_confirmed','Independent multi-disciplinary contractor est. 1997, Abu Dhabi + Dubai + Saudi Arabia offices, ~2,550 employees claimed. Careers page directly confirmed.'],
  ['uae-pilot-0385','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','https://linkedin.com/company/scanconstruction','company_page_exists_but_no_careers_evidence','Independent firm est. 1991, Abu Dhabi, ISO-certified, 200+ projects claimed. Has company LinkedIn but no careers page found.'],
  ['uae-pilot-0027','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','none found this pass','not_confirmed','Real independent EPCM contracting firm, Abu Dhabi. No careers page or LinkedIn found.'],
  ['uae-pilot-0162','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','none found this pass','not_confirmed','Independent firm est. 2003 (20+ yrs), Dubai, active project portfolio (Arjan, Dubai Hills, Jumeirah Park). No careers page or LinkedIn found.'],
  ['uae-pilot-0362','needs_more_evidence','blocked_technical','not_confirmed_this_pass','','unknown','','not_confirmed','Connection reset on fetch - could not verify. Needs a manual browser check.'],
  ['uae-pilot-0008','new_verified','confirmed_official','dedicated_careers_page','https://www.atginteriors.com/careers','unknown','linkedin.com/company/a&t-group-interiors','company_page_usable','Independent interior fit-out firm operating since 2009, Dubai + Riyadh, named major clients (Emaar, Nakheel, Talabat), 350+ projects, 30,000 sq.ft. facility. Careers page directly confirmed.'],
  ['uae-pilot-0201','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','https://www.linkedin.com/company/exceptional-interior-decoration-llc/','company_page_exists_but_no_careers_evidence','Independent family-owned firm, 25+ yrs, Dubai. Has company LinkedIn but no careers page found.'],
  ['uae-pilot-0251','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','linkedin.com/company/interior-design-xperts','company_page_exists_but_no_careers_evidence','Independent firm est. 2018, Dubai, services span commercial/hospitality/healthcare/education/retail sectors. Has company LinkedIn but no careers page found.'],
  ['uae-pilot-0395','needs_more_evidence','blocked_technical','not_confirmed_this_pass','','unknown','','not_confirmed','HTTP 500 Internal Server Error on fetch - could not verify. Needs a manual browser check.'],

  ['uae-pilot-0398','needs_more_evidence','confirmed_official_weak_evidence','none_found_general_contact_only','','none','none found this pass','not_confirmed','Named major clients (ADNOC, FAB, Aldar) but the fetched content itself reads as placeholder/generic text ("may be under development"), a real caution flag. No careers page. Abu Dhabi + Dubai offices claimed.'],
  ['uae-pilot-0011','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','none found this pass','not_confirmed','Real but young independent firm (founded 2021), Abu Dhabi, named principals. No careers page or LinkedIn found.'],
  ['uae-pilot-0170','needs_more_evidence','blocked_technical','not_confirmed_this_pass','','unknown','','not_confirmed','TLS certificate expired at fetch time - could not verify. Needs a manual browser check.'],
  ['uae-pilot-0200','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','none found this pass','not_confirmed','Real independent firm, Abu Dhabi, named authority liaisons (Municipality, Civil Defense, Urban Planning Council). No careers page or LinkedIn found. Content professionally maintained but no formal registration/license number visible.'],
  ['uae-pilot-0314','new_verified','confirmed_official','dedicated_careers_page','https://www.mwazinoon.ae/recruitment/','unknown','none found this pass','not_confirmed','Independent firm founded by 3 Emirati engineers, Abu Dhabi. Dedicated "Recruitment" nav link directly confirmed (sub-page content not independently rendered this pass). Note: site explicitly disclaims relation to some portfolio images shown - a minor transparency flag, not disqualifying.'],
  ['uae-pilot-0047','needs_more_evidence','confirmed_official_content_quality_flag','none_found_general_contact_only','','none','referenced in footer, not independently confirmed','not_confirmed','Independent firm (Al Khawaja/KWEC), Dubai, named real project portfolio (Luxor Tower, SAAS Hills). CAUTION: fetched content also contained unrelated casino/gambling affiliate content mixed in with the page - a real legitimacy/compromised-site concern, flagged explicitly rather than ignored. No careers page confirmed.'],
  ['uae-pilot-0064','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','none found this pass','not_confirmed','Real firm (Al Turath/TEC), Dubai, but the site itself displays an "under construction" notice, limiting available evidence. No careers page.'],
  ['uae-pilot-0157','new_verified','confirmed_official','dedicated_careers_page','careers ("Career" nav link observed, sub-page not independently rendered)','unknown','company presence referenced on Facebook/Instagram/LinkedIn (URL not directly captured)','not_confirmed','Independent firm, Dubai. "Career" link directly observed in site navigation; footer credits a third-party web developer (MaximaGroup, unrelated to Datum itself).'],
  ['uae-pilot-0315','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','https://www.linkedin.com/company/nakashi','company_page_usable_but_no_careers_evidence','Independent lighting-design consultancy, Dubai + GCC, explicitly states no brand/distributor affiliations (genuinely independent). Has company LinkedIn but no careers page found.'],
  ['uae-pilot-0351','needs_more_evidence','blocked_technical','not_confirmed_this_pass','','unknown','','not_confirmed','TLS hostname mismatch (cert only valid for the non-www variant) - could not verify. Needs a manual browser check.'],
  ['uae-pilot-0305','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','company LinkedIn referenced (URL not directly captured)','not_confirmed','Independent firm founded 1972 (one of the longer-established candidates), Dubai HQ + branches in RAK, Abu Dhabi, and 3 other countries, 720+ projects claimed. Has company LinkedIn but no careers page found.'],

  ['uae-pilot-0300','new_verified','confirmed_official','confirmed_central_ats','https://careers.mediclinic.com/MiddleEast/?locale=en_GB','custom_portal_mediclinic_middle_east','not independently confirmed this pass','not_confirmed','Confirmed facility of the Mediclinic Middle East hospital group (a major private-hospital operator across the UAE). A central, group-wide careers/ATS portal was directly confirmed and linked from this specific Al Mamora, Abu Dhabi facility page.'],
  ['uae-pilot-0257','new_verified','confirmed_official','dedicated_careers_page','careers page ("/careers-knee-surgery-abu-dhabi-uae.html" path observed)','unknown','none found this pass','not_confirmed','Independent specialty orthopedic center, Abu Dhabi, MOH-licensed, named international consultant surgeons, affiliations with AAOS/RACS/BMI Healthcare. Careers page directly confirmed.'],
  ['uae-pilot-0115','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','linkedin.com/company/bhmc-uae (name mismatch vs "BHSH" flagged, not independently resolved)','not_confirmed','Independent hospital, Abu Dhabi, MOHAP-licensed, named CEO/Founder. LinkedIn slug ("bhmc-uae") does not exactly match the company\'s own name ("BHSH") - flagged as an unresolved identity discrepancy, not silently assumed to match. No careers page.'],
  ['uae-pilot-0134','needs_more_evidence','blocked_technical','not_confirmed_this_pass','','unknown','','not_confirmed','seha.ae (the government SEHA hospital network domain) returned HTTP 403 again this pass - consistent with the same block already documented for Corniche Hospital, Zayed Military Hospital, and Sheikh Khalifa Medical City in the prior enrichment pass. Confirms this is a systemic seha.ae-wide block, not an isolated issue.'],
  ['uae-pilot-0320','needs_more_evidence','blocked_technical','not_confirmed_this_pass','','unknown','','not_confirmed','Two fetch attempts (homepage empty content, /about-us insufficient) returned no substantive content - likely JS-rendered. Needs a manual browser check.'],
  ['uae-pilot-0184','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','linkedin.com/company/eclipseclinicuae','company_page_usable_but_no_careers_evidence','Independent clinic, Dubai, multiple named licensed practitioners, accepts multiple insurers. Has company LinkedIn but no careers page found.'],
  ['uae-pilot-0183','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','none found this pass','not_confirmed','Real independent ENT/multi-department medical center, Dubai, MOH-licensed. No careers page or LinkedIn found.'],
  ['uae-pilot-0033','needs_more_evidence','confirmed_official','none_found_general_contact_only','','none','none found this pass','not_confirmed','Real medical centre, Dubai (Al Karama), DHA-licensed. Located in a named building ("Kanoo Group Building") but no evidence found that it is itself part of the Kanoo Group corporate structure - flagged as an open question, not assumed either way. No careers page.'],
  ['uae-pilot-253b','new_verified','confirmed_official','dedicated_careers_page','https://www.imh.ae/careers','unknown','mentioned as active (@international-modern-hospital), URL not directly captured','not_confirmed','Real legal name is "International Modern Hospital (IMH)" (Google Maps listing name "IMH Corporate Office" was a location label, not the legal name - corrected here). Est. 2005, Dubai, 117+ beds, 30+ specialties, 100+ doctors, ACHS International accredited. Careers page directly confirmed.'],
  ['uae-pilot-0429','rejected','no_official_source_found','not_applicable','','not_applicable','not_applicable','not_applicable','Google Maps supplied only a business.google.com mini-site URL, which now returns HTTP 404 - no working official domain exists. Consistent with the weak-domain-tier flag this row already carried during triage scoring.'],
];

// Fix the manual id typo for IMH (was already uae-pilot-0253 in the selection; ensure single row)
for (const f of F) { if (f[0] === 'uae-pilot-253b') f[0] = 'uae-pilot-0253'; }

const byIdF = {}; for (const f of F) byIdF[f[0]] = f;
console.log('findings rows:', F.length, '(should be 50)');
const missing = selected.filter(s => !byIdF[s.internal_row_id]);
console.log('selected rows with NO finding (should be empty):', missing.map(m=>m.internal_row_id+' '+m.canonical_name));
const extra = F.filter(f => !byId[f[0]]);
console.log('findings with NO matching selected row (should be empty):', extra.map(f=>f[0]));

const classCounts = {};
for (const f of F) classCounts[f[1]] = (classCounts[f[1]]||0)+1;
console.log('classification counts:', classCounts);

// Write deep-verification-50.csv
const rows50 = F.map(f => {
  const s = byId[f[0]] || {};
  return {
    internal_row_id: f[0], canonical_name: s.canonical_name || '', city: s.city || '', sector_label: s.sector_label || '',
    verification_classification: f[1], website_verification_status: f[2], careers_source_type: f[3], careers_page_url: f[4],
    ats_provider_detected: f[5], linkedin_company_url: f[6], linkedin_usable: f[7], researcher_notes: f[8],
    official_website_url: s.website || '', normalized_domain: s.normalized_domain || '', google_maps_url: s.google_maps_url || '',
    verification_date: '2026-09-07',
  };
});
writeCsv(path.join(__dirname, 'deep-verification-50.csv'),
  ['internal_row_id','canonical_name','city','sector_label','verification_classification','website_verification_status','careers_source_type','careers_page_url','ats_provider_detected','linkedin_company_url','linkedin_usable','researcher_notes','official_website_url','normalized_domain','google_maps_url','verification_date'],
  rows50);

module.exports = { rows50 };
