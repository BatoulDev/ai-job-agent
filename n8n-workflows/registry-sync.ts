/**
 * Registry Sync — n8n Workflow SDK source
 *
 * IMPORT INSTRUCTIONS
 * ───────────────────
 * Import the companion JSON file via n8n UI → (hamburger menu) → Import
 * from File → registry-sync.json, or via n8n MCP create_workflow_from_code /
 * update_workflow using this source. Reconciled 2026-09-24 against the live
 * n8n workflow "AI Job Agent - Registry Sync - step 1 (manual)"
 * (id LpDt8c8811kTCF2a) after manual/Google Sheets/Apify were all tested
 * successfully in that instance — node set, connections, and shared
 * candidate-processing pipeline confirmed structurally identical via
 * n8n-mcp get_workflow_details. See the PR/commit notes for exactly what
 * was and wasn't verified.
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
 *   3. Type: Google Sheets OAuth2 (or Service Account), Name: "Google
 *      Sheets" — only required for mode='google_sheets'. Bound directly to
 *      the Read Google Sheet Candidates node, never referenced from
 *      Workflow Configuration. Not bound in the committed JSON — bind it
 *      manually in n8n once a real Google credential is available.
 *
 * WORKFLOW CONFIGURATION NODE (first node after the trigger — edit before running)
 * ──────────────────────────────────────────────────────────────────────────────
 *   mode                  — 'manual' | 'google_sheets' | 'apify'. Selects
 *                            exactly one input adapter per execution; never
 *                            mixed. The operator sets this before clicking
 *                            Execute — nothing switches it automatically.
 *                            (CSV text-paste mode was removed — see
 *                            "GOOGLE SHEETS REPLACES CSV" below.)
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
 *   discoveryRunId          — a real UUID generated once per execution by
 *                            the dedicated Generate Discovery Run ID node
 *                            (not this node — see that node's own comment
 *                            for why), passed as p_discovery_run_id to
 *                            every resolve_registry_candidate() call in
 *                            this run — the correlation id for "which
 *                            Registry Sync run saw this."
 *   startedAt               — execution start timestamp, for the summary's
 *                            duration figure.
 *   googleSheetSpreadsheetId — mode='google_sheets' only. Empty by default.
 *                            The target spreadsheet's plain ID (not a
 *                            secret) — read by the Read Google Sheet
 *                            Candidates node via an expression, so the
 *                            operator changes which sheet is read entirely
 *                            from this field, never by editing that node.
 *   googleSheetTabName      — mode='google_sheets' only. The tab/sheet name
 *                            to read — "Registry Sync Candidates" is the
 *                            tab actually used in the working sheet. Same
 *                            expression-driven pattern as the spreadsheet
 *                            id above.
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
 * GOOGLE SHEETS REPLACES CSV
 * ─────────────────────────────
 * mode='csv' (raw CSV text pasted into Workflow Configuration.csvContent,
 * parsed by a hand-rolled Code-node parser) has been removed — pasting an
 * entire file's contents into a node field was never a practical real-world
 * input path. mode='google_sheets' replaces it: the operator maintains a
 * normal Google Sheet, Registry Sync reads it directly via the native
 * Google Sheets node every run, no copy/paste required. discovery_source
 * 'csv' remains a fully valid, permanently supported value everywhere in
 * the database (migration 20260923120000 only ADDED 'google_sheets', never
 * removed 'csv') — historical companies/company_sources rows created by
 * the original standalone import script (scripts/import-company-registry.mjs,
 * unrelated to and unaffected by this workflow) still carry it, and it is
 * still accepted if anything ever calls resolve_registry_candidate() with
 * p_discovery_source='csv' directly. Only this n8n workflow's own input
 * mode was retired, not the database's memory of it.
 *
 * CORE ARCHITECTURE — one resolution boundary, three adapters
 * ─────────────────────────────────────────────────────────────
 *   Manual ────────┐
 *   Google Sheets ─┼──> Normalize Candidates ──> Validate Candidate ──>
 *   Apify ─────────┘        (shared, one shape)      (company_name only —
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
 * That is what makes repeated execution, Google Sheet re-reads, overlapping
 * executions, and Manual→Google Sheets→Apify rediscovery of the same source
 * all safe by construction: the atomicity and identity guarantees live in Postgres
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

import { workflow, node, trigger, ifElse, splitInBatches, nextBatch, newCredential, expr } from '@n8n/workflow-sdk';

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
          { id: 'started-at-field', name: 'startedAt', value: expr('{{ $now.toISO() }}'), type: 'string' },
          { id: 'google-sheet-spreadsheet-id-field', name: 'googleSheetSpreadsheetId', value: '', type: 'string' },
          { id: 'google-sheet-tab-name-field', name: 'googleSheetTabName', value: 'Registry Sync Candidates', type: 'string' },
          { id: 'apify-dataset-id-field', name: 'apifyDatasetId', value: '', type: 'string' },
          { id: 'apify-max-items-field', name: 'apifyMaxItems', value: 50, type: 'number' },
          { id: 'timeout-field', name: 'timeoutSeconds', value: 15, type: 'number' },
        ],
      },
    },
  },
  output: [{ mode: 'manual', supabaseBaseUrl: 'http://host.docker.internal:55321', environment: 'local', maxCandidatesPerRun: 25, startedAt: '2026-09-21T00:00:00.000Z', googleSheetSpreadsheetId: '', googleSheetTabName: 'Registry Sync Candidates', apifyDatasetId: '', apifyMaxItems: 50, timeoutSeconds: 15 }],
});

// Generates ONE real UUID per Registry Sync execution — runs exactly once,
// upstream of Process Candidates' per-candidate batch loop, so every
// candidate processed in this execution reads the identical discoveryRunId
// via $('Generate Discovery Run ID').first() (the same safe pattern this
// workflow already uses for $('Workflow Configuration').first() from inside
// that same loop). Lives in its own Code node rather than inside Workflow
// Configuration itself: only specific built-in functions, not raw Node
// globals like crypto, are available inside a Set node's own {{ }}
// expression — this replaces the previous
// $jmespath($now, "@").split(".")[0]-based attempt, which reliably
// evaluated to an empty string and never produced a valid uuid.
const generateDiscoveryRunId = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Generate Discovery Run ID',
    position: [250, 100],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "let uuid;\n" +
        "try {\n" +
        "  uuid = require('crypto').randomUUID();\n" +
        "} catch (e) {\n" +
        "  // Fallback RFC4122 v4 uuid if the Code node sandbox blocks require('crypto').\n" +
        "  uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {\n" +
        "    const r = (Math.random() * 16) | 0;\n" +
        "    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);\n" +
        "  });\n" +
        "}\n" +
        "return [{ json: { discoveryRunId: uuid } }];",
    },
  },
  output: [{ discoveryRunId: '5b1f2c3a-9e4d-4b6a-8c2e-1a2b3c4d5e6f' }],
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

const isGoogleSheetsMode = ifElse({
  version: 2.3,
  config: {
    name: 'Is Google Sheets Mode?',
    position: [700, 300],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr("{{ $('Workflow Configuration').first().json.mode }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'google_sheets' }],
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

// Read Google Sheet Candidates: the native Google Sheets node (resource
// 'sheet', operation 'read') — reads the configured tab's rows directly,
// one n8n item per row, using the real installed node schema (confirmed
// via n8n MCP get_node_types, not guessed). Spreadsheet and tab both come
// from Workflow Configuration via expressions in the resource-locator
// `value` fields — the operator changes which sheet is read by editing
// that ONE node's fields, never this node. mode: 'id'/'name' (not 'list')
// deliberately, since 'list' mode expects a UI-resolved cachedResultName
// and cannot take a pure expression value the way 'id'/'name' can. No real
// spreadsheet id is ever committed here — the placeholder is empty,
// exactly like apifyDatasetId's own empty-by-default convention.
const readGoogleSheetCandidates = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'Read Google Sheet Candidates',
    position: [1000, 300],
    parameters: {
      resource: 'sheet',
      operation: 'read',
      authentication: 'oAuth2',
      documentId: {
        __rl: true,
        mode: 'id',
        value: expr("{{ $('Workflow Configuration').first().json.googleSheetSpreadsheetId }}"),
      },
      sheetName: {
        __rl: true,
        mode: 'name',
        value: expr("{{ $('Workflow Configuration').first().json.googleSheetTabName }}"),
      },
      options: {},
    },
    credentials: { googleSheetsOAuth2Api: newCredential('Google Sheets') },
  },
  output: [{ company_name: 'Example Discovered Co', country_code: 'LB', official_website_url: 'https://example.com', official_careers_url: 'https://example.com/careers' }],
});

// Extract Google Sheet Candidates: the Google Sheets node already emits one
// n8n item per row (no parsing needed, unlike CSV text) — this step only
// wraps each row into the same { discovery_source, raw } envelope every
// other adapter produces. Deliberately does not apply maxCandidatesPerRun
// here (same convention as Load Manual Candidates and the Apify branch):
// that bound is enforced once, in Normalize Candidates, the single shared
// bounding point regardless of which adapter produced the items.
const extractGoogleSheetCandidates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Extract Google Sheet Candidates',
    position: [1300, 300],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const rows = $input.all().map((i) => i.json);\n" +
        "return rows.map((r) => ({ json: { discovery_source: 'google_sheets', raw: r } }));",
    },
  },
  output: [{ discovery_source: 'google_sheets', raw: { company_name: 'Example Company', country_code: 'LB', official_website_url: 'https://example.com', official_careers_url: 'https://example.com/careers' } }],
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
        "    company_name: firstNonEmpty(raw.company_name, raw.name, raw.title),\n" +
        "    country_code: firstNonEmpty(raw.country_code, raw.country, raw.countryCode),\n" +
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
        "{{ { p_discovery_source: $json.discovery_source, p_company_name: $json.company_name, p_country_code: $json.country_code, p_official_website_url: $json.official_website_url, p_official_careers_url: $json.official_careers_url, p_company_id_hint: $json.company_id_hint, p_ats_provider_hint: $json.ats_provider_hint, p_discovery_run_id: $('Generate Discovery Run ID').first().json.discoveryRunId, p_raw_payload: $json.raw_payload } }}"
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
        "const discoveryRunId = $('Generate Discovery Run ID').first().json.discoveryRunId;\n" +
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
        "  runId: discoveryRunId,\n" +
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

// The single documentation sticky note for this canvas — a plain-English
// walkthrough for a non-technical reader coming back months later. Placed
// well below the main flow so it doesn't sit over any node or connection
// line. Adds no logic — purely explanatory. Previously this canvas also had
// three smaller, overlapping notes (Overview, Safety Invariants, Apify
// Trust Boundary); their meaning is folded in here (sections 5 and 8) and
// they were removed to avoid duplicated/stale documentation living in two
// places at once. Rewritten to describe the REAL, currently-implemented
// workflow after the CSV-paste input mode was replaced with Google Sheets.
const quickGuideNote = node({
  type: 'n8n-nodes-base.stickyNote',
  version: 1,
  config: {
    name: 'Registry Sync Quick Guide',
    position: [-688, 1250],
    parameters: {
      width: 1200,
      height: 3150,
      content:
        '## REGISTRY SYNC — QUICK GUIDE\n\n' +
        '**1. Purpose**\n' +
        'Registry Sync takes newly discovered companies/career-source candidates — typed in by hand, read from a ' +
        'Google Sheet, or read from an Apify dataset — and safely checks them against our official company registry.\n' +
        'It does NOT collect job postings, and it does NOT figure out which applicant-tracking system (ATS) a ' +
        'company uses. Those happen in other workflows.\n\n' +
        '**2. Start / configuration**\n' +
        '- Start Registry Sync Run → the manual button you click to run this workflow. It never runs on its own.\n' +
        '- Workflow Configuration → where you set the mode (manual / google_sheets / apify) and other settings ' +
        'before running. For Google Sheets mode, this is also where you set googleSheetSpreadsheetId (which ' +
        'spreadsheet) and googleSheetTabName (which tab) — you never need to edit the Read Google Sheet Candidates ' +
        'node itself to point at a different sheet.\n' +
        '- The Google account Registry Sync reads the sheet as is attached to the Read Google Sheet Candidates ' +
        'node itself, as an n8n Credential — never typed into Workflow Configuration, never stored in this file.\n' +
        '- Generate Discovery Run ID → creates one unique ID for this run, so every candidate checked in this run ' +
        'can be traced back to it later.\n' +
        '- Manual Candidates Input → where you type company details directly. Only used when mode = manual.\n\n' +
        '**3. Manual scenario (mode = manual)**\n' +
        'Start Registry Sync Run → Workflow Configuration → Generate Discovery Run ID → Manual Candidates Input → ' +
        'Is Manual Mode? → Load Manual Candidates → shared processing (section 6)\n' +
        '- Is Manual Mode? → checks whether mode is set to "manual".\n' +
        '- Load Manual Candidates → reads the companies you typed in and gets them ready to be checked.\n\n' +
        '**4. Google Sheets scenario (mode = google_sheets)**\n' +
        'Is Manual Mode? (No) → Is Google Sheets Mode? (Yes) → Read Google Sheet Candidates → Extract Google ' +
        'Sheet Candidates → shared processing (section 6)\n' +
        '- Read Google Sheet Candidates → reads every row directly from the configured Google Sheet tab, right ' +
        'at run time. No copying, no pasting, no CSV file needed — you just keep the sheet up to date and run ' +
        'Registry Sync.\n' +
        '- Extract Google Sheet Candidates → gets each row ready to be checked, the same way every other input ' +
        'does.\n' +
        '- The sheet needs a header row with these column names: company_name (required — a row without this is ' +
        'rejected before it reaches the database), and country_code, official_website_url, official_careers_url, ' +
        'company_id_hint, ats_provider_hint (all optional).\n\n' +
        '**5. Apify scenario (mode = apify)**\n' +
        'Is Manual Mode? (No) → Is Google Sheets Mode? (No) → Fetch Apify Dataset → Evaluate Apify Fetch → ' +
        'retry/wait if needed → Extract Apify Candidates → shared processing (section 6)\n' +
        '- Fetch Apify Dataset → reads a list of companies that Apify already collected earlier. IMPORTANT: this ' +
        'only READS a finished dataset — it does NOT start a new Apify run. The dataset ID is set on purpose by a ' +
        'person before running — never automatic, never guessed.\n' +
        '- Evaluate Apify Fetch → checks whether that read worked.\n' +
        '- Should Retry Apify Fetch? / Compute Apify Backoff / Apify Backoff Wait → if the read failed for a ' +
        'temporary reason (like a timeout), these wait a short time and try again, up to a few times, so one ' +
        'hiccup does not stop the whole run.\n' +
        '- Extract Apify Candidates → pulls the company list out of a successful response.\n\n' +
        '**6. Shared processing (used by all three scenarios)**\n' +
        '- Normalize Candidates → makes manual, Google Sheets, and Apify data look the same shape, so the rest ' +
        'of the workflow does not need to care where a candidate came from.\n' +
        '- Process Candidates → goes through the candidates one at a time.\n' +
        '- Validate Candidate → checks that the candidate at least has a company name. Nothing else is checked ' +
        'here.\n' +
        '- Is Candidate Valid? → sends valid candidates onward, and sends candidates missing a name to be ' +
        'recorded as failed.\n' +
        '- Resolve Registry Candidate → asks the database to decide: is this a brand-new company/source, an ' +
        'existing one, or unclear? This is the ONLY step that writes to the registry.\n' +
        '- Classify RPC Outcome → reads the database\'s answer and labels what happened to this candidate.\n' +
        '- Build Validation Failed Result → records a candidate that was missing a name, before it ever reached ' +
        'the database.\n' +
        '- Build Run Summary → once every candidate has been checked, this builds one summary of the whole run.\n\n' +
        '**7. Possible outcomes**\n' +
        '- created_new → a brand-new company/source was added to the registry.\n' +
        '- resolved_existing → the company/source was already known and was reused — no duplicate was created.\n' +
        '- staged → the candidate is uncertain or incomplete (for example, missing or unrecognized country, or ' +
        'no usable website/careers link), so it was set aside for a person to review instead of guessing and ' +
        'polluting the registry.\n' +
        '- validation_failed → the candidate\'s own info was invalid (usually a missing name) before it ever ' +
        'reached the database.\n' +
        '- infrastructure_failed → a technical problem (network, timeout, database) happened while checking this ' +
        'candidate. It is safe to run again later.\n\n' +
        '**8. Important boundaries**\n' +
        '- Registry Sync only discovers/resolves company sources.\n' +
        '- Source Intelligence later classifies unknown sources.\n' +
        '- Job Ingestion later fetches the actual jobs.\n' +
        '- New or uncertain candidates should never bypass Resolve Registry Candidate.\n' +
        '- Discovering a company/source never approves it. Registry Sync cannot set review or approval status — ' +
        'that is always a separate, deliberate action by a person.\n' +
        '- It is safe to run this workflow more than once, or to have two runs overlap — the database (not this ' +
        'workflow) prevents duplicates.\n' +
        '- The database decides if two entries are really the same company/source (using the company, its ' +
        'country, and the source together) — this workflow never guesses that itself.\n' +
        '- A missing or unrecognized country is never blocked by this workflow — that candidate is simply sent ' +
        'to the database, which safely sets it aside for review. Country checking is never duplicated here.\n' +
        '- This workflow should stay switched OFF unless someone is intentionally running or configuring it.',
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
  .onFalse(isGoogleSheetsMode.onTrue(readGoogleSheetCandidates.to(extractGoogleSheetCandidates.to(sharedFromNormalize))).onFalse(apifyBranch));

const mainFlow = workflowConfiguration.to(generateDiscoveryRunId.to(manualCandidatesInput.to(inputRouting)));

export default workflow('registry-sync', 'AI Job Agent - Registry Sync - step 1 (manual)')
  .add(startTrigger)
  .to(mainFlow)
  .add(quickGuideNote);
