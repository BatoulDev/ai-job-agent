#!/usr/bin/env node
// scripts/import-company-registry.mjs
//
// Idempotently imports docs/job-source-discovery/{lebanon,uae,saudi-arabia,
// qatar,kuwait,international-remote}.csv into public.companies and
// public.company_sources (supabase/migrations/20260914150000_create_
// companies_and_company_sources.sql). Deliberately NOT
// master-company-registry.csv — that file is itself a rebuild of the six
// country files (verified in the readiness audit, Section 7), so importing
// it too would double-process every row.
//
// Safe to run repeatedly: every row upserts on its own stable id
// (company_sources.id = the CSV's source_record_id; companies.id = the
// CSV's canonical_company_id, or its converged target — see
// CONVERGENCE_MAP below). A second run with unchanged CSVs writes the
// identical values back — company_sources_reject_remap
// (20260914150000) hard-stops the one case this script must never cause:
// silently pointing an existing source at a different company than before.
//
// Human identity decision this script implements (docs/job-ingestion-
// database-readiness-audit.md Sections 21-22): Amazon UAE/Saudi Arabia and
// Accenture Saudi Arabia/Qatar are NOT in CONVERGENCE_MAP and so import as
// four distinct companies, exactly as their four distinct
// canonical_company_id values already say. SLB (3 source rows), Tata
// Consultancy Services (2), and Apparel Group (2) ARE in CONVERGENCE_MAP —
// their original company_sources.id (= source_record_id) and every other
// provenance field are preserved exactly; only company_id converges onto
// one shared companies row. review_status is carried through unmodified —
// this script never promotes a needs_manual_review/no_official_source_
// found/blocked_or_unsafe row to "approved" by importing it.
//
// LOCAL DEVELOPMENT ONLY (same guard as scripts/seed-local-automation-
// users.mjs): refuses to run unless NEXT_PUBLIC_SUPABASE_URL resolves to
// 127.0.0.1/localhost, and refuses unless public.company_sources already
// exists (i.e. migrations are applied).
//
// Usage:
//   node scripts/import-company-registry.mjs             # import (safe to rerun)
//   node scripts/import-company-registry.mjs --dry-run    # parse + report, write nothing

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const registryDir = path.join(projectRoot, "docs", "job-source-discovery");

function fail(message) {
  console.error(`\n[import-company-registry] ERROR: ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------
// Env loading — same tiny parser as scripts/seed-local-automation-users.mjs
// (no "dotenv" dependency for a one-off local script).
// ---------------------------------------------------------------------
function loadEnvLocal() {
  const envPath = path.join(projectRoot, ".env.local");
  const env = {};
  if (existsSync(envPath)) {
    for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
  return env;
}
const fileEnv = loadEnvLocal();
const getEnv = (name) => process.env[name] ?? fileEnv[name];

const isDryRun = new Set(process.argv.slice(2)).has("--dry-run");

// ---------------------------------------------------------------------
// Minimal RFC4180 CSV parser (no dependency): required because several
// researcher_notes/terms_or_access_notes fields contain embedded commas,
// quotes, and literal newlines inside quoted fields (e.g. `[Supplied
// LinkedIn lead, raw input: "Accenture Middle East"]`) — a naive
// line.split(",") would silently corrupt those rows.
// ---------------------------------------------------------------------
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export function parseCsvFile(filePath) {
  const text = readFileSync(filePath, "utf8").replace(/^﻿/, ""); // strip BOM
  const rows = parseCsv(text);
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, idx) => [h, (r[idx] ?? "").trim()])));
}

// ---------------------------------------------------------------------
// Human identity decision (docs/job-ingestion-database-readiness-audit.md
// Section 22): only these five source-side canonical_company_id values
// converge onto a shared bare id. Every other row's company_id equals its
// own canonical_company_id unchanged — Amazon and Accenture's four rows
// are deliberately NOT listed here and so stay four distinct companies.
// ---------------------------------------------------------------------
export const CONVERGENCE_MAP = {
  "cc-slb-qatar": "cc-slb",
  "cc-slb-formerly-schlumberger": "cc-slb",
  "cc-tata-consultancy-services-qatar": "cc-tcs",
  "cc-apparel-group-sa": "cc-apparel-group",
};

const SOURCE_FILES = ["lebanon.csv", "uae.csv", "saudi-arabia.csv", "qatar.csv", "kuwait.csv", "international-remote.csv"];

export function loadAllRows() {
  const rows = [];
  for (const file of SOURCE_FILES) {
    const filePath = path.join(registryDir, file);
    if (!existsSync(filePath)) fail(`Expected CSV not found: ${filePath}`);
    for (const row of parseCsvFile(filePath)) rows.push({ ...row, __file: file });
  }
  return rows;
}

export function resolveCompanyId(canonicalId) {
  return CONVERGENCE_MAP[canonicalId] ?? canonicalId;
}

// Deterministic display-name choice when multiple source rows converge
// onto one company: prefer the row whose OWN canonical_company_id already
// equals the resolved id (i.e. the row that was already using the bare
// form), falling back to first-encountered order otherwise.
export function buildCompanies(rows) {
  const byId = new Map();
  for (const row of rows) {
    const companyId = resolveCompanyId(row.canonical_company_id);
    const isCanonicalRow = row.canonical_company_id === companyId;
    const existing = byId.get(companyId);
    if (!existing || (isCanonicalRow && !existing.__fromCanonicalRow)) {
      byId.set(companyId, { id: companyId, display_name: row.company_name, __fromCanonicalRow: isCanonicalRow });
    }
  }
  return [...byId.values()].map(({ id, display_name }) => ({ id, display_name }));
}

export function buildCompanySources(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (seen.has(row.source_record_id)) {
      fail(`Duplicate source_record_id across CSV files: ${row.source_record_id} (in ${row.__file})`);
    }
    seen.add(row.source_record_id);
    out.push({
      id: row.source_record_id,
      company_id: resolveCompanyId(row.canonical_company_id),
      company_name: row.company_name,
      target_country: row.target_country,
      country_code: row.country_code || null,
      official_website_url: row.official_website_url || null,
      official_careers_url: row.official_careers_url || null,
      ats_provider: row.ats_provider || null,
      automation_eligibility: row.automation_eligibility || null,
      review_status: row.review_status,
      researcher_notes: row.researcher_notes || null,
      last_verified_at: row.last_verified_at || null,
    });
  }
  return out;
}

async function main() {
  const rows = loadAllRows();
  const companies = buildCompanies(rows);
  const companySources = buildCompanySources(rows);

  const convergedCount = rows.filter((r) => CONVERGENCE_MAP[r.canonical_company_id]).length;
  console.log(`[import-company-registry] Parsed ${rows.length} CSV rows across ${SOURCE_FILES.length} files.`);
  console.log(`[import-company-registry] -> ${companies.length} distinct companies (${convergedCount} source rows converged via CONVERGENCE_MAP).`);
  console.log(`[import-company-registry] -> ${companySources.length} company_sources rows (1:1 with source_record_id).`);

  const reviewCounts = companySources.reduce((acc, r) => {
    acc[r.review_status] = (acc[r.review_status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`[import-company-registry] review_status distribution: ${JSON.stringify(reviewCounts)}`);

  if (isDryRun) {
    console.log("[import-company-registry] --dry-run: no database writes performed.");
    return;
  }

  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseSecretKey = getEnv("SUPABASE_SECRET_KEY");
  if (!supabaseUrl) fail("NEXT_PUBLIC_SUPABASE_URL is not set (.env.local).");
  if (!supabaseSecretKey) fail("SUPABASE_SECRET_KEY is not set (.env.local) — this script needs service-role access to bypass RLS, same boundary as src/lib/supabase/admin.ts.");

  let parsedUrl;
  try {
    parsedUrl = new URL(supabaseUrl);
  } catch {
    fail(`NEXT_PUBLIC_SUPABASE_URL is not a valid URL: ${supabaseUrl}`);
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname)) {
    fail(`Refusing to run: NEXT_PUBLIC_SUPABASE_URL ("${supabaseUrl}") is not a local address. This script only ever runs against 127.0.0.1/localhost.`);
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { error: probeError } = await supabase.from("company_sources").select("id").limit(1);
  if (probeError) {
    fail(`Could not read public.company_sources (${probeError.message}). Have migrations been applied (npx supabase migration up --local)?`);
  }

  const { error: companiesError } = await supabase.from("companies").upsert(companies, { onConflict: "id" });
  if (companiesError) fail(`companies upsert failed: ${companiesError.message}`);
  console.log(`[import-company-registry] Upserted ${companies.length} companies rows.`);

  const { error: sourcesError } = await supabase.from("company_sources").upsert(companySources, { onConflict: "id" });
  if (sourcesError) {
    fail(
      `company_sources upsert failed: ${sourcesError.message}\n` +
        (sourcesError.message?.includes("company_sources.company_id cannot be changed")
          ? "This means a source's canonical-company mapping actually changed since the last import — that is a real identity decision, not something this script will apply silently. Review the conflicting row manually before proceeding."
          : "")
    );
  }
  console.log(`[import-company-registry] Upserted ${companySources.length} company_sources rows.`);
  console.log("[import-company-registry] Done.");
}

// Only run as a side effect when invoked directly (`node
// scripts/import-company-registry.mjs`), never when the pure parsing/
// convergence functions above are imported by a test (e.g.
// tests/db/company-registry-import.test.mjs).
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMainModule) {
  main();
}
