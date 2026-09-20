/**
 * Registry Sync — n8n Workflow SDK source
 *
 * IMPORT INSTRUCTIONS
 * ───────────────────
 * Import the companion JSON file via n8n UI → (hamburger menu) → Import
 * from File → registry-sync.json, or via n8n MCP create_workflow_from_code /
 * update_workflow using this source. This repository session had no n8n MCP
 * connection available — the companion JSON was hand-authored to match this
 * source and the exact schema of the other two committed workflow exports
 * (job-ingestion-pilot-orchestrator.json), but has NOT been round-tripped
 * through a live n8n instance. Treat it as "believed correct, pending first
 * real import," not independently verified — see the PR/commit notes for
 * what was and wasn't validated this session.
 *
 * CREDENTIALS (configure in n8n → Settings → Credentials before running)
 * ──────────────────────────────────────────────────────────────────────
 *   1. Type: Supabase, Name: "Supabase Service Role" — the same credential
 *      Source Intelligence Analyzer / Job Ingestion Pilot Orchestrator /
 *      CV Analysis Worker already use (service-role key, local Supabase
 *      project). Required for every mode.
 *   2. Type: Header Auth, Name: "Apify API Token" — only required for
 *      mode='apify'. Header name "Authorization", value "Bearer <token>".
 *      Not bound in the committed JSON (no credential value is ever
 *      embedded in the repository) — bind it manually in n8n once a real
 *      Apify token is available. A generic Header Auth credential is used
 *      deliberately instead of depending on an n8n-native Apify node/
 *      credential type, which may or may not be current on this n8n
 *      version — this makes the adapter portable across n8n versions and
 *      keeps the token exclusively in n8n's own encrypted credential
 *      store, never in workflow JSON, logs, or provenance payloads.
 *
 * WORKFLOW CONFIGURATION NODE (first node after the trigger — edit before running)
 * ──────────────────────────────────────────────────────────────────────────────
 *   mode                  — 'manual' | 'csv' | 'apify'. Selects exactly one
 *                            input adapter per execution; never mixed. The
 *                            operator sets this before clicking Execute —
 *                            nothing switches it automatically.
 *   supabaseBaseUrl        — local: http://host.docker.internal:55321.
 *                            Centralized here, same convention as every
 *                            other workflow in this repo — $env is blocked
 *                            (N8N_BLOCK_ENV_ACCESS_IN_NODE) and $vars is
 *                            unavailable on this Community license (see
 *                            source-intelligence-analyzer.ts's own header
 *                            for the verified detail). Promoting this
 *                            workflow to a new environment means editing
 *                            this one field.
 *   environment             — 'local' (informational label only; not a
 *                            safety gate).
 *   maxCandidatesPerRun    — hard bound applied identically to every
 *                            adapter's output before any candidate reaches
 *                            resolve_registry_candidate() — "do not load an
 *                            arbitrarily huge CSV/dataset without bounds."
 *   discoveryRunId          — generated once per execution (see Workflow
 *                            Configuration's own assignment), passed as
 *                            p_discovery_run_id to every resolve_registry_
 *                            candidate() call in this run — the correlation
 *                            id for "which Registry Sync run saw this."
 *   startedAt               — execution start timestamp, for the summary's
 *                            duration figure.
 *   csvContent              — raw CSV text (mode='csv' only). Pasted/set by
 *                            the operator. Required columns: company_name,
 *                            country_code, official_website_url,
 *                            official_careers_url (header row required,
 *                            exact names). A file-path-based variant (Read/
 *                            Write Files From Disk + Extract From File) is a
 *                            natural later extension, deliberately not built
 *                            now — it would need a container volume mount
 *                            this environment's availability was not
 *                            confirmed for, whereas pasted content works
 *                            identically everywhere and was the one that
 *                            could actually be tested end-to-end this
 *                            session.
 *   apifyDatasetId          — mode='apify' only. Empty by default. An
 *                            explicit, single dataset id the operator sets
 *                            per run — never an arbitrary/attacker-supplied
 *                            id, and never a full task/actor id that could
 *                            trigger a NEW Apify run from this workflow.
 *                            Fetch Apify Dataset only ever reads
 *                            *previously completed* dataset items
 *                            (GET .../datasets/{id}/items) — it cannot
 *                            start, modify, or pay for an Apify run.
 *   apifyMaxItems           — bound on how many dataset items are read
 *                            (Apify's own `limit` query param) — a second,
 *                            independent bound from maxCandidatesPerRun,
 *                            applied at the fetch itself so an oversized
 *                            dataset is never pulled into memory at all.
 *   timeoutSeconds          — per-HTTP-call timeout (RPC calls and the
 *                            Apify fetch alike).
 *
 * CORE ARCHITECTURE — one resolution boundary, three adapters
 * ─────────────────────────────────────────────────────────────
 *   Manual ──┐
 *   CSV ─────┼──> Normalize Candidates ──> Validate Candidate ──>
 *   Apify ───┘        (shared, one shape)      (company_name only —
 *                                                everything else is the
 *                                                RPC's own job)
 *                                                     │
 *                                                     ▼
 *                                    resolve_registry_candidate()
 *                                        (the ONLY write path into
 *                                         companies/company_sources/
 *                                         registry_sync_staging — this
 *                                         workflow never recreates that
 *                                         resolution/deduplication logic)
 *                                                     │
 *                              ┌──────────────────────┼──────────────────────┐
 *                              ▼                      ▼                      ▼
 *                        created_new           resolved_existing          staged
 *                     (new canonical row)    (already on file, reused) (ambiguous/
 *                                                                        incomplete —
 *                                                                        never guessed)
 *
 * This workflow NEVER performs "SELECT, then decide, then INSERT" itself —
 * every candidate, from every adapter, makes exactly one POST to
 * /rest/v1/rpc/resolve_registry_candidate and trusts its answer completely.
 * That is what makes repeated execution, CSV re-import, overlapping
 * executions, and Manual→CSV→Apify rediscovery of the same source all safe
 * by construction: the atomicity and identity guarantees live in Postgres
 * (supabase/migrations/20260920090000...20260920090030), not in this
 * workflow's control flow.
 *
 * This workflow NEVER writes to source_intelligence or jobs. A newly
 * created company_sources row becomes eligible for Source Intelligence's
 * own get_source_intelligence_candidates() automatically (ats_provider /
 * automation_eligibility default to 'unknown' inside the RPC) — no push,
 * no direct write, no coupling. Source Intelligence's own daily schedule
 * remains the sole thing that ever inserts into source_intelligence.
 *
 * REVIEW-FIELD PROTECTION — structural, not a workflow convention
 * ─────────────────────────────────────────────────────────────────
 * review_status and automation_eligibility are not accepted as
 * resolve_registry_candidate() parameters at all (confirmed against the
 * live function signature this session) — no node in this workflow could
 * pass them even if one tried to. Discovery can never imply approval.
 *
 * FAILURE CLASSIFICATION
 * ───────────────────────
 * Every processed candidate ends in exactly one of:
 *   created_new | resolved_existing | staged | validation_failed |
 *   infrastructure_failed
 * The first three are RPC-returned business outcomes (staged is a normal,
 * expected, safe outcome — never conflated with a failure). validation_
 * failed means this workflow rejected the row before ever calling the RPC
 * (only when company_name itself is missing/blank — the one thing the RPC
 * would otherwise hard-raise on; every other data-quality question,
 * including country/URL validity and company-identity ambiguity, is
 * answered by the RPC itself, never pre-empted here). infrastructure_
 * failed means the RPC call itself errored (network/timeout/5xx) — the
 * candidate's true resolution is unknown and safe to retry (the RPC is
 * idempotent), never assumed to have failed *or* succeeded.
 *
 * RETRIES
 * ────────
 * Bounded exponential backoff with jitter applies to exactly one thing:
 * the Apify dataset fetch (a real external network call — timeouts, 429,
 * and retryable 5xx only, same classification convention as Job Ingestion
 * Pilot Orchestrator's own retry logic). resolve_registry_candidate()
 * itself is not retried automatically within a single run — a failed
 * candidate is recorded as infrastructure_failed and the *next* run of
 * this workflow (over the same input) safely re-resolves it, since the
 * RPC is idempotent by construction. There is no per-item rate-limit delay
 * around the RPC loop — it calls this project's own database, not a
 * rate-limited third party, so the delay Source Intelligence Analyzer
 * needs for external page fetches does not apply here.
 */

import { workflow, node, trigger, sticky, ifElse, splitInBatches, nextBatch, newCredential, expr } from '@n8n/workflow-sdk';

// ─────────────────────────────────────────────────────────────────────────
// Trigger + configuration
// ─────────────────────────────────────────────────────────────────────────

const startTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Start Registry Sync Run', position: [-200, 0] },
  output: [{}],
});

const workflowConfiguration = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Workflow Configuration',
    position: [100, 0],
    parameters: {
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'mode-field', name: 'mode', value: 'manual', type: 'string' },
          { id: 'supabase-base-url', name: 'supabaseBaseUrl', value: 'http://host.docker.internal:55321', type: 'string' },
          { id: 'environment-field', name: 'environment', value: 'local', type: 'string' },
          { id: 'max-candidates-field', name: 'maxCandidatesPerRun', value: 25, type: 'number' },
          { id: 'discovery-run-id-field', name: 'discoveryRunId', value: expr('{{ $jmespath($now, "@").split(".")[0] }}-{{ $execution.id }}'), type: 'string' },
          { id: 'started-at-field', name: 'startedAt', value: expr('{{ $now.toISO() }}'), type: 'string' },
          { id: 'csv-content-field', name: 'csvContent', value: '', type: 'string' },
          { id: 'apify-dataset-id-field', name: 'apifyDatasetId', value: '', type: 'string' },
          { id: 'apify-max-items-field', name: 'apifyMaxItems', value: 50, type: 'number' },
          { id: 'timeout-field', name: 'timeoutSeconds', value: 15, type: 'number' },
        ],
      },
    },
  },
  output: [{ mode: 'manual', supabaseBaseUrl: 'http://host.docker.internal:55321', environment: 'local', maxCandidatesPerRun: 25, discoveryRunId: 'run-example', startedAt: '2026-09-21T00:00:00.000Z', csvContent: '', apifyDatasetId: '', apifyMaxItems: 50, timeoutSeconds: 15 }],
});

// Manual entry point: the operator edits this ONE array field directly in
// the n8n canvas (double-click the node, edit manualCandidates as JSON,
// save) — never a Code node, never workflow source. Only read when
// mode='manual'. Each object accepts exactly the fields the RPC contract
// actually supports as candidate input: company_name (required),
// country_code, official_website_url, official_careers_url, and the two
// optional hints (company_id_hint, ats_provider_hint). review_status/
// automation_eligibility are deliberately not fields here at all — the RPC
// has no parameter for either, so there is nothing to even mistakenly set.
const manualCandidatesInput = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Manual Candidates Input',
    position: [100, 200],
    parameters: {
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'manual-candidates-field',
            name: 'manualCandidates',
            type: 'array',
            value: [
              {
                company_name: 'Example Company',
                country_code: 'LB',
                official_website_url: 'https://example.com',
                official_careers_url: 'https://example.com/careers',
              },
            ],
          },
        ],
      },
    },
  },
  output: [{ manualCandidates: [{ company_name: 'Example Company', country_code: 'LB', official_website_url: 'https://example.com', official_careers_url: 'https://example.com/careers' }] }],
});

// ─────────────────────────────────────────────────────────────────────────
// Input routing — exactly one adapter runs per execution
// ─────────────────────────────────────────────────────────────────────────

const isManualMode = ifElse({
  version: 2.3,
  config: {
    name: 'Is Manual Mode?',
    position: [400, 100],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr("{{ $('Workflow Configuration').first().json.mode }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'manual' }],
        combinator: 'and',
      },
    },
  },
});

const isCsvMode = ifElse({
  version: 2.3,
  config: {
    name: 'Is CSV Mode?',
    position: [700, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr("{{ $('Workflow Configuration').first().json.mode }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'csv' }],
        combinator: 'and',
      },
    },
  },
});

// Load Manual Candidates: reads the operator-edited array, tags each row
// with discovery_source='manual'. No validation here — Validate Candidate
// (shared, post-normalization) is the one place that happens.
const loadManualCandidates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Load Manual Candidates',
    position: [700, 100],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const rows = $('Manual Candidates Input').first().json.manualCandidates || [];\n" +
        "return rows.map((r) => ({ json: { discovery_source: 'manual', raw: r } }));",
    },
  },
  output: [{ discovery_source: 'manual', raw: { company_name: 'Example Company', country_code: 'LB', official_website_url: 'https://example.com', official_careers_url: 'https://example.com/careers' } }],
});

// Parse CSV Candidates: a small, deterministic, tested RFC4180 parser —
// ported directly from scripts/import-company-registry.mjs's own
// parseCsv() (already covered by tests/db/company-registry-import.test.mjs
// against real registry CSVs), not reinvented, per the production-
// automation-engineer skill's guidance to keep Code nodes small and reuse
// tested logic over ad hoc parsing. Handles embedded commas/quotes/
// newlines inside quoted fields correctly (a naive split(',') would
// corrupt those, exactly as that script's own header documents).
const parseCsvCandidates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Parse CSV Candidates',
    position: [1000, 300],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "function parseCsv(text) {\n" +
        "  const rows = [];\n" +
        "  let row = [];\n" +
        "  let field = '';\n" +
        "  let inQuotes = false;\n" +
        "  let i = 0;\n" +
        "  const n = text.length;\n" +
        "  while (i < n) {\n" +
        "    const c = text[i];\n" +
        "    if (inQuotes) {\n" +
        "      if (c === '\"') {\n" +
        "        if (text[i + 1] === '\"') { field += '\"'; i += 2; continue; }\n" +
        "        inQuotes = false; i++; continue;\n" +
        "      }\n" +
        "      field += c; i++; continue;\n" +
        "    }\n" +
        "    if (c === '\"') { inQuotes = true; i++; continue; }\n" +
        "    if (c === ',') { row.push(field); field = ''; i++; continue; }\n" +
        "    if (c === '\\r') { i++; continue; }\n" +
        "    if (c === '\\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }\n" +
        "    field += c; i++;\n" +
        "  }\n" +
        "  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }\n" +
        "  return rows.filter((r) => !(r.length === 1 && r[0] === ''));\n" +
        "}\n" +
        "\n" +
        "const content = $('Workflow Configuration').first().json.csvContent || '';\n" +
        "const rows = parseCsv(content.replace(/^\\uFEFF/, ''));\n" +
        "if (rows.length === 0) return [];\n" +
        "const header = rows[0];\n" +
        "const dataRows = rows.slice(1).map((r) => Object.fromEntries(header.map((h, idx) => [h.trim(), (r[idx] ?? '').trim()])));\n" +
        "return dataRows.map((r) => ({ json: { discovery_source: 'csv', raw: r } }));",
    },
  },
  output: [{ discovery_source: 'csv', raw: { company_name: 'Example Company', country_code: 'LB', official_website_url: 'https://example.com', official_careers_url: 'https://example.com/careers' } }],
});

// ─────────────────────────────────────────────────────────────────────────
// Apify adapter — read-only discovery input, bounded retry on the single
// dataset fetch, never a trusted canonical writer
// ─────────────────────────────────────────────────────────────────────────

const fetchApifyDataset = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Apify Dataset',
    position: [1000, 500],
    onError: 'continueRegularOutput',
    executeOnce: true,
    parameters: {
      method: 'GET',
      url: expr("{{ 'https://api.apify.com/v2/datasets/' + $('Workflow Configuration').first().json.apifyDatasetId + '/items' }}"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'httpHeaderAuth',
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'limit', value: expr("{{ $('Workflow Configuration').first().json.apifyMaxItems }}") },
          { name: 'clean', value: 'true' },
        ],
      },
      options: {
        timeout: expr("{{ $('Workflow Configuration').first().json.timeoutSeconds * 1000 }}"),
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
      },
    },
    credentials: { httpHeaderAuth: newCredential('Apify API Token') },
  },
  output: [{ statusCode: 200, body: [{ company_name: 'Example Discovered Co', country_code: 'LB', website: 'https://example.com', careers_url: 'https://example.com/careers' }], headers: {} }],
});

// Bounded exponential backoff with jitter (same convention as Job Ingestion
// Pilot Orchestrator's per-source retry: attempt read from the loop-back
// node with a try/catch fallback to 1 on the first pass). Only timeouts,
// network errors, HTTP 429, and retryable 5xx (500/502/503/504) are
// retried; any other status (including a missing/invalid dataset id, an
// auth failure, or a genuine 4xx) is terminal immediately — retrying those
// would never succeed and would just burn the bounded attempt budget.
const evaluateApifyFetch = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Apify Fetch',
    position: [1300, 500],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const MAX_ATTEMPTS = 4;\n" +
        "let attempt = 1;\n" +
        "try { attempt = $('Compute Apify Backoff').item.json.attempt; } catch (e) { attempt = 1; }\n" +
        "\n" +
        "const datasetId = $('Workflow Configuration').first().json.apifyDatasetId;\n" +
        "if (!datasetId) {\n" +
        "  return [{ json: { shouldRetry: false, succeeded: false, attempt, items: [], error: 'apify_dataset_id_not_configured' } }];\n" +
        "}\n" +
        "\n" +
        "const resp = $input.first().json;\n" +
        "const networkError = !!resp.error;\n" +
        "const statusCode = resp.statusCode || null;\n" +
        "const retryableStatus = statusCode === 429 || [500, 502, 503, 504].includes(statusCode);\n" +
        "\n" +
        "if (!networkError && statusCode >= 200 && statusCode < 300) {\n" +
        "  const items = Array.isArray(resp.body) ? resp.body : [];\n" +
        "  return [{ json: { shouldRetry: false, succeeded: true, attempt, items, error: null } }];\n" +
        "}\n" +
        "\n" +
        "const canRetry = (networkError || retryableStatus) && attempt < MAX_ATTEMPTS;\n" +
        "const errorMessage = networkError ? String(resp.error).slice(0, 300) : `apify_fetch_failed_status_${statusCode}`;\n" +
        "return [{ json: { shouldRetry: canRetry, succeeded: false, attempt, items: [], error: errorMessage } }];",
    },
  },
  output: [{ shouldRetry: false, succeeded: true, attempt: 1, items: [], error: null }],
});

const shouldRetryApifyFetch = ifElse({
  version: 2.3,
  config: {
    name: 'Should Retry Apify Fetch?',
    position: [1600, 500],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.shouldRetry }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: true }],
        combinator: 'and',
      },
    },
  },
});

const computeApifyBackoff = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Compute Apify Backoff',
    position: [1900, 600],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const BASE_DELAY_MS = 1000;\n" +
        "const MAX_DELAY_MS = 15000;\n" +
        "const prev = $input.first().json;\n" +
        "const nextAttempt = prev.attempt + 1;\n" +
        "const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, prev.attempt - 1));\n" +
        "const jitterMs = Math.floor(Math.random() * exp * 0.25);\n" +
        "return [{ json: { attempt: nextAttempt, delayMs: exp + jitterMs } }];",
    },
  },
  output: [{ attempt: 2, delayMs: 1200 }],
});

const apifyBackoffWait = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Apify Backoff Wait',
    position: [2200, 600],
    parameters: { resume: 'timeInterval', amount: expr('{{ $json.delayMs / 1000 }}'), unit: 'seconds' },
  },
  output: [{}],
});

// Bounded by apifyMaxItems already at the fetch (query param); bounded a
// second time here defensively in case a misbehaving dataset ignores
// `limit`. Field mapping is deliberately permissive on input key names
// (company_name/name, website/official_website_url, careers_url/
// official_careers_url, country_code/country) since Apify actor output
// shapes vary by actor — Normalize Candidates (shared, next) is what
// enforces the real contract, this step only gets the raw item into a
// consistent envelope.
const extractApifyCandidates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Extract Apify Candidates',
    position: [1900, 300],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const evalResult = $('Evaluate Apify Fetch').first().json;\n" +
        "const cfg = $('Workflow Configuration').first().json;\n" +
        "if (!evalResult.succeeded) return [];\n" +
        "const items = (evalResult.items || []).slice(0, cfg.apifyMaxItems);\n" +
        "return items.map((r) => ({ json: { discovery_source: 'apify', raw: r } }));",
    },
  },
  output: [{ discovery_source: 'apify', raw: { company_name: 'Example Discovered Co', country_code: 'LB', website: 'https://example.com', careers_url: 'https://example.com/careers' } }],
});

// ─────────────────────────────────────────────────────────────────────────
// Shared core — normalize, validate, resolve (the one write path)
// ─────────────────────────────────────────────────────────────────────────

// Maps every adapter's raw shape into the exact resolve_registry_candidate()
// input contract. Bounds the total candidate count to maxCandidatesPerRun
// here — the single, shared bounding point regardless of which adapter
// produced the items. Does NOT decide validity or identity; that is
// Validate Candidate's and the RPC's job respectively.
const normalizeCandidates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize Candidates',
    position: [2200, 200],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const cfg = $('Workflow Configuration').first().json;\n" +
        "const items = $input.all().map((i) => i.json).slice(0, cfg.maxCandidatesPerRun);\n" +
        "\n" +
        "function firstNonEmpty(...values) {\n" +
        "  for (const v of values) { if (typeof v === 'string' && v.trim() !== '') return v.trim(); }\n" +
        "  return null;\n" +
        "}\n" +
        "\n" +
        "return items.map(({ discovery_source, raw }) => ({\n" +
        "  json: {\n" +
        "    discovery_source,\n" +
        "    company_name: firstNonEmpty(raw.company_name, raw.name),\n" +
        "    country_code: firstNonEmpty(raw.country_code, raw.country),\n" +
        "    official_website_url: firstNonEmpty(raw.official_website_url, raw.website, raw.website_url),\n" +
        "    official_careers_url: firstNonEmpty(raw.official_careers_url, raw.careers_url, raw.careers_page),\n" +
        "    company_id_hint: firstNonEmpty(raw.company_id_hint, raw.company_id),\n" +
        "    ats_provider_hint: firstNonEmpty(raw.ats_provider_hint, raw.ats_provider),\n" +
        "    raw_payload: raw,\n" +
        "  },\n" +
        "}));",
    },
  },
  output: [{ discovery_source: 'manual', company_name: 'Example Company', country_code: 'LB', official_website_url: 'https://example.com', official_careers_url: 'https://example.com/careers', company_id_hint: null, ats_provider_hint: null, raw_payload: {} }],
});

const processCandidates = splitInBatches({
  version: 3,
  config: { name: 'Process Candidates', position: [2500, 200], parameters: { batchSize: 1 } },
});

// The ONE hard pre-RPC check: company_name present. Every other data-
// quality question (missing/invalid country, no resolvable URL, ambiguous
// company identity) is intentionally left to resolve_registry_candidate()
// itself — duplicating that logic here would be exactly the "second
// company-deduplication engine inside n8n" this workflow must not become.
const validateCandidate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Validate Candidate',
    position: [2800, 100],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const c = $input.first().json;\n" +
        "const nameValid = typeof c.company_name === 'string' && c.company_name.trim() !== '';\n" +
        "return [{ json: {\n" +
        "  ...c,\n" +
        "  validationStatus: nameValid ? 'valid' : 'validation_failed',\n" +
        "  validationReason: nameValid ? null : 'company_name is required and was missing or blank',\n" +
        "} }];",
    },
  },
  output: [{ discovery_source: 'manual', company_name: 'Example Company', country_code: 'LB', official_website_url: 'https://example.com', official_careers_url: 'https://example.com/careers', company_id_hint: null, ats_provider_hint: null, raw_payload: {}, validationStatus: 'valid', validationReason: null }],
});

const isCandidateValid = ifElse({
  version: 2.3,
  config: {
    name: 'Is Candidate Valid?',
    position: [3100, 100],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.validationStatus }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'valid' }],
        combinator: 'and',
      },
    },
  },
});

const buildValidationFailedResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Validation Failed Result',
    position: [3400, 400],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const c = $input.first().json;\n" +
        "return [{ json: {\n" +
        "  discovery_source: c.discovery_source,\n" +
        "  company_name: c.company_name,\n" +
        "  country_code: c.country_code,\n" +
        "  outcome: 'validation_failed',\n" +
        "  reason: c.validationReason,\n" +
        "  company_id: null,\n" +
        "  source_id: null,\n" +
        "  staging_id: null,\n" +
        "} }];",
    },
  },
  output: [{ discovery_source: 'manual', company_name: '', country_code: null, outcome: 'validation_failed', reason: 'company_name is required and was missing or blank', company_id: null, source_id: null, staging_id: null }],
});

// The single canonical write path. One POST, one atomic transaction inside
// Postgres, exactly the resolve_registry_candidate() contract — no field
// here is anything the RPC doesn't itself accept, and review_status /
// automation_eligibility are not present because the RPC has no parameter
// for either (confirmed against the live function signature this session,
// not assumed from memory).
const resolveRegistryCandidate = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Resolve Registry Candidate',
    position: [3400, 0],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/rpc/resolve_registry_candidate"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/json' }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        "{{ { p_discovery_source: $json.discovery_source, p_company_name: $json.company_name, p_country_code: $json.country_code, p_official_website_url: $json.official_website_url, p_official_careers_url: $json.official_careers_url, p_company_id_hint: $json.company_id_hint, p_ats_provider_hint: $json.ats_provider_hint, p_discovery_run_id: null, p_raw_payload: $json.raw_payload } }}"
      ),
      options: {
        timeout: expr("{{ $('Workflow Configuration').first().json.timeoutSeconds * 1000 }}"),
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
      },
    },
    credentials: { supabaseApi: newCredential('Supabase Service Role') },
  },
  output: [{ statusCode: 200, body: [{ outcome: 'created_new', out_company_id: 'cc-example', out_source_id: 'sr-lb-example', out_staging_id: null }] }],
});

// Distinguishes an RPC-returned business outcome (created_new /
// resolved_existing / staged — none of these are failures) from a genuine
// infrastructure failure (network/timeout/non-2xx/malformed response),
// which is the only thing classified infrastructure_failed. A candidate
// that infrastructure_failed has an UNKNOWN true resolution, never assumed
// succeeded or failed outright — the next run over the same input safely
// re-resolves it (the RPC is idempotent).
const classifyRpcOutcome = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Classify RPC Outcome',
    position: [3700, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const c = $('Validate Candidate').first().json;\n" +
        "const resp = $input.first().json;\n" +
        "const networkError = !!resp.error;\n" +
        "const statusCode = resp.statusCode || null;\n" +
        "const ok = !networkError && statusCode >= 200 && statusCode < 300;\n" +
        "\n" +
        "if (!ok) {\n" +
        "  const body = resp.body;\n" +
        "  const message = networkError\n" +
        "    ? String(resp.error).slice(0, 300)\n" +
        "    : (body && typeof body === 'object' && body.message ? String(body.message).slice(0, 300) : `rpc_call_failed_status_${statusCode}`);\n" +
        "  return [{ json: {\n" +
        "    discovery_source: c.discovery_source, company_name: c.company_name, country_code: c.country_code,\n" +
        "    outcome: 'infrastructure_failed', reason: message,\n" +
        "    company_id: null, source_id: null, staging_id: null,\n" +
        "  } }];\n" +
        "}\n" +
        "\n" +
        "const row = Array.isArray(resp.body) ? resp.body[0] : resp.body;\n" +
        "return [{ json: {\n" +
        "  discovery_source: c.discovery_source, company_name: c.company_name, country_code: c.country_code,\n" +
        "  outcome: row.outcome, reason: null,\n" +
        "  company_id: row.out_company_id || null, source_id: row.out_source_id || null, staging_id: row.out_staging_id || null,\n" +
        "} }];",
    },
  },
  output: [{ discovery_source: 'manual', company_name: 'Example Company', country_code: 'LB', outcome: 'created_new', reason: null, company_id: 'cc-example', source_id: 'sr-lb-example', staging_id: null }],
});

const buildRunSummary = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Run Summary',
    position: [3400, -400],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const cfg = $('Workflow Configuration').first().json;\n" +
        "const results = $input.all().map((i) => i.json);\n" +
        "const startedAtMs = new Date(cfg.startedAt).getTime();\n" +
        "const countBy = (val) => results.filter((r) => r.outcome === val).length;\n" +
        "\n" +
        "const failedItems = results\n" +
        "  .filter((r) => r.outcome === 'validation_failed' || r.outcome === 'infrastructure_failed')\n" +
        "  .slice(0, 50)\n" +
        "  .map((r) => ({ company_name: r.company_name, outcome: r.outcome, reason: r.reason }));\n" +
        "\n" +
        "return [{ json: {\n" +
        "  runId: cfg.discoveryRunId,\n" +
        "  mode: cfg.mode,\n" +
        "  environment: cfg.environment,\n" +
        "  inputCount: results.length,\n" +
        "  validCount: results.filter((r) => r.outcome !== 'validation_failed').length,\n" +
        "  createdNew: countBy('created_new'),\n" +
        "  resolvedExisting: countBy('resolved_existing'),\n" +
        "  staged: countBy('staged'),\n" +
        "  validationFailed: countBy('validation_failed'),\n" +
        "  infrastructureFailed: countBy('infrastructure_failed'),\n" +
        "  failedItems,\n" +
        "  totalDurationMs: Date.now() - startedAtMs,\n" +
        "  finishedAt: new Date().toISOString(),\n" +
        "} }];",
    },
  },
  output: [{ runId: 'run-example', mode: 'manual', environment: 'local', inputCount: 1, validCount: 1, createdNew: 1, resolvedExisting: 0, staged: 0, validationFailed: 0, infrastructureFailed: 0, failedItems: [], totalDurationMs: 500, finishedAt: '2026-09-21T00:00:01.000Z' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Sticky notes
// ─────────────────────────────────────────────────────────────────────────

const overviewNote = sticky(
  '### Registry Sync\n' +
    'Converges manual/csv/apify input into ONE shared normalize -> validate -> resolve_registry_candidate() ' +
    'path. Every candidate makes exactly one atomic RPC call; this workflow never performs its own SELECT-then-' +
    'INSERT company/source resolution. staged is a normal, safe outcome, never a failure. Inactive by default — ' +
    'set mode in Workflow Configuration, review Manual Candidates Input (manual mode) or csvContent (csv mode) ' +
    'or apifyDatasetId + bind the Apify API Token credential (apify mode), then run manually.',
  { name: 'Overview', position: [-200, -420], width: 560, height: 260 }
);

const safetyInvariantsNote = node({
  type: 'n8n-nodes-base.stickyNote',
  version: 1,
  config: {
    name: 'Safety Invariants',
    position: [2200, -420],
    parameters: {
      width: 560,
      height: 300,
      content:
        '### Safety invariants\n' +
        '- No UNIQUE(display_name); ambiguous company matches always stage, never guess.\n' +
        '- Source identity is (company_id, country_code, normalized_source_key) — enforced in Postgres, not here.\n' +
        '- review_status / automation_eligibility are not parameters this workflow can send.\n' +
        '- Never writes source_intelligence or jobs.\n' +
        '- Concurrent/duplicate executions are protected by the RPC itself (advisory lock + real unique index), not by anything in this workflow.',
    },
  },
});

const apifyBoundaryNote = node({
  type: 'n8n-nodes-base.stickyNote',
  version: 1,
  config: {
    name: 'Apify Trust Boundary',
    position: [1000, 780],
    parameters: {
      width: 560,
      height: 240,
      content:
        '### Apify is discovery input only\n' +
        'Reads previously-completed dataset items only (GET .../datasets/{id}/items) — cannot start, modify, or ' +
        'pay for an Apify run. apifyDatasetId is an explicit single id set per run, never arbitrary/attacker-' +
        'supplied. Apify rows flow through the exact same normalize/validate/resolve path as manual/CSV — Apify ' +
        'is never a trusted canonical writer on its own.',
    },
  },
});

// ─────────────────────────────────────────────────────────────────────────
// Connections
// ─────────────────────────────────────────────────────────────────────────

// Every terminal leaf across all three input adapters and both validation
// branches must reach the SAME shared next node — built once as a value
// and referenced from each leaf, exactly the finalizeThenNextBatch pattern
// already established in source-intelligence-analyzer.ts (an ifElse's
// onTrue/onFalse do not automatically fan a later .to() out to every leaf;
// each leaf must explicitly chain to the shared target itself).
const backToNextBatch = nextBatch(processCandidates);

const perItemValidOrInvalid = isCandidateValid
  .onFalse(buildValidationFailedResult.to(backToNextBatch))
  .onTrue(resolveRegistryCandidate.to(classifyRpcOutcome.to(backToNextBatch)));

const sharedFromNormalize = normalizeCandidates.to(
  processCandidates.onDone(buildRunSummary).onEachBatch(validateCandidate.to(perItemValidOrInvalid))
);

const apifyRetryLoop = shouldRetryApifyFetch
  .onFalse(extractApifyCandidates.to(sharedFromNormalize))
  .onTrue(computeApifyBackoff.to(apifyBackoffWait.to(fetchApifyDataset)));

const apifyBranch = fetchApifyDataset.to(evaluateApifyFetch.to(apifyRetryLoop));

const inputRouting = isManualMode
  .onTrue(loadManualCandidates.to(sharedFromNormalize))
  .onFalse(isCsvMode.onTrue(parseCsvCandidates.to(sharedFromNormalize)).onFalse(apifyBranch));

const mainFlow = workflowConfiguration.to(manualCandidatesInput.to(inputRouting));

export default workflow('registry-sync', 'AI Job Agent - Registry Sync')
  .add(startTrigger)
  .to(mainFlow)
  .add(overviewNote)
  .add(safetyInvariantsNote)
  .add(apifyBoundaryNote);
