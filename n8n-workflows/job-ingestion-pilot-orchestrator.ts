/**
 * Job Ingestion — Pilot Orchestrator — n8n Workflow SDK source
 *
 * IMPORT INSTRUCTIONS
 * ───────────────────
 * Import the companion JSON file via n8n UI → (hamburger menu) → Import
 * from File → job-ingestion-pilot-orchestrator.json, or via n8n MCP
 * create_workflow_from_code / update_workflow using this source.
 *
 * CREDENTIALS (configure in n8n → Settings → Credentials before running)
 * ──────────────────────────────────────────────────────────────────────
 *   Type: Supabase, Name: "Supabase Service Role" (same credential the
 *   CV Analysis Worker uses — service-role key, local Supabase project).
 *
 * WORKFLOW CONFIGURATION NODE (first node after the trigger — edit before running)
 * ──────────────────────────────────────────────────────────────────────────────
 *   mode               — 'dry_run' (default, no DB writes) or 'local_pilot'
 *                         (bounded DB writes to the local jobs table)
 *   supabaseBaseUrl     — local: http://host.docker.internal:55321. Centralized
 *                         here deliberately — every downstream node reads it via
 *                         $('Workflow Configuration').first().json.supabaseBaseUrl,
 *                         never a second literal copy. n8n environment variables
 *                         ($env) and Variables ($vars) were both evaluated as
 *                         alternatives and are not usable on this instance —
 *                         $env is blocked (N8N_BLOCK_ENV_ACCESS_IN_NODE), and
 *                         Variables requires a license tier this Community
 *                         install doesn't have (verified via `n8n license:info`
 *                         inside the container, 2026-09-19 — no variables
 *                         entitlement present). Promoting this workflow to a
 *                         new n8n environment means editing this one field by
 *                         hand — see docs/PRODUCTION_READINESS.md's n8n
 *                         promotion checklist.
 *   environment         — 'local' (informational label). Included in Build
 *                         Execution Summary only — nothing in this workflow
 *                         branches on it; it is not a safety gate.
 *   maxJobsPerSource    — bounded cap on jobs written per source in local_pilot
 *   rateLimitDelaySeconds — pause between sources (conservative per-source rate limit)
 *
 * SCOPE
 * ─────
 * Four pre-verified pilot sources (Greenhouse x2, Lever x1, Workable x1),
 * hardcoded by company_sources.id below. Every run re-checks each source's
 * review_status/automation_eligibility live against company_sources before
 * fetching — the hardcoded id list is never trusted as authorization by
 * itself. No Schedule Trigger. Workflow stays inactive until explicitly
 * activated by a human after this pilot is reviewed.
 *
 * RETRY / BACKOFF — bounded exponential backoff with jitter
 * ───────────────────────────────────────────────────────────
 * n8n's Code node sandbox has no network access, so retry cannot be a
 * hidden node-native setting — it is a real graph loop per adapter:
 *   Fetch <ATS> Jobs → Evaluate <ATS> Fetch Attempt (classify + compute
 *   backoff) → Should Retry <ATS>? → [true: Compute Backoff <ATS> → Wait
 *   → back to Fetch <ATS> Jobs] / [false: Classify & Normalize <ATS>].
 * Only timeouts/connection failures, HTTP 429, and retryable 5xx
 * (500/502/503/504) are retried; permanent 4xx (any non-429) and
 * non-retryable 5xx are classified and passed straight through, never
 * retried. Bounded to RETRY_MAX_ATTEMPTS total attempts (1 initial + up to
 * 3 retries). Delay is exponential (RETRY_BASE_DELAY_MS * 2^(attempt-1))
 * capped at RETRY_MAX_DELAY_MS, with jitter applied via Math.random() —
 * tests control this by stubbing Math.random before invoking the
 * extracted jsCode. A valid `Retry-After` header on a 429 overrides the
 * computed delay (still capped at RETRY_MAX_DELAY_MS). Real retry count is
 * exposed per source as `retries` in the run summary; final classification
 * is exposed as `outcome`.
 *
 * COUNTRY_CODE / CITY — DOCUMENTED LIMITATION
 * ────────────────────────────────────────────
 * None of the three adapters' list endpoints return a structured,
 * reliably-parseable city/country for a per-job basis without guessing
 * from free text. jobs.location carries the raw source string; jobs.city
 * and jobs.country_code are left NULL rather than invented.
 * upgrade path: resolve country_code via the countries table once a
 * specific source is confirmed to provide structured geography.
 */

import {
  workflow,
  node,
  trigger,
  sticky,
  ifElse,
  switchCase,
  splitInBatches,
  nextBatch,
  newCredential,
  expr,
} from '@n8n/workflow-sdk';

// ─────────────────────────────────────────────────────────────────────────
// Retry: bounded exponential backoff with jitter.
//
// The n8n Workflow SDK's own code-validator disallows top-level function/
// arrow-function declarations (confirmed: "Arrow functions are not
// allowed" / "Function declarations are not allowed in SDK code"), so the
// per-adapter "Evaluate <ATS> Fetch Attempt" and "Compute Backoff <ATS>"
// jsCode strings below cannot be generated by a shared helper — each is
// inlined directly in its own node, identical in logic to the other two
// adapters except for the ATS label used in error messages and the
// "Compute Backoff <ATS>" node name each one reads its attempt counter
// back from. Constants: RETRY_MAX_ATTEMPTS = 4 (1 initial + up to 3
// retries), RETRY_BASE_DELAY_MS = 500, RETRY_MAX_DELAY_MS = 8000. Only
// network/timeout, HTTP 429, and retryable 5xx (500/502/503/504) are ever
// retried; every other 4xx/5xx is permanent.
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// Trigger + configuration
// ─────────────────────────────────────────────────────────────────────────

const startTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Start Pilot Run', position: [-200, 0] },
  output: [{}],
});

const workflowConfiguration = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Workflow Configuration',
    position: [100, 0],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'mode-field', name: 'mode', value: 'dry_run', type: 'string' },
          { id: 'supabase-base-url', name: 'supabaseBaseUrl', value: 'http://host.docker.internal:55321', type: 'string' },
          { id: 'environment-field', name: 'environment', value: 'local', type: 'string' },
          { id: 'max-jobs-field', name: 'maxJobsPerSource', value: 5, type: 'number' },
          { id: 'rate-limit-field', name: 'rateLimitDelaySeconds', value: 2, type: 'number' },
          { id: 'started-at-field', name: 'startedAt', value: expr('{{ $now.toISO() }}'), type: 'string' },
        ],
      },
    },
  },
  output: [{ mode: 'dry_run', supabaseBaseUrl: 'http://host.docker.internal:55321', environment: 'local', maxJobsPerSource: 5, rateLimitDelaySeconds: 2, startedAt: '2026-09-15T00:00:00.000Z' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Load approved pilot sources (static adapter config only — never company
// data; company_name/review_status/automation_eligibility are always
// re-fetched live from company_sources below, never trusted from here).
// ─────────────────────────────────────────────────────────────────────────

const loadApprovedPilotSources = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Load Approved Pilot Sources',
    position: [400, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const PILOT_SOURCES = [\n" +
        "  { source_id: 'sr-qa-scale-ai', ats_type: 'greenhouse', feed_url: 'https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=true' },\n" +
        "  { source_id: 'sr-sa-alpaca',   ats_type: 'greenhouse', feed_url: 'https://boards-api.greenhouse.io/v1/boards/alpaca/jobs?content=true' },\n" +
        "  { source_id: 'sr-intl-wahed',  ats_type: 'lever',      feed_url: 'https://api.lever.co/v0/postings/wahed.com?mode=json' },\n" +
        "  { source_id: 'sr-sa-salla',    ats_type: 'workable',   feed_url: 'https://apply.workable.com/api/v1/widget/accounts/salla?details=true' },\n" +
        "];\n" +
        "return PILOT_SOURCES.map(s => ({ json: s }));",
    },
  },
  output: [
    { source_id: 'sr-qa-scale-ai', ats_type: 'greenhouse', feed_url: 'https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=true' },
    { source_id: 'sr-sa-alpaca', ats_type: 'greenhouse', feed_url: 'https://boards-api.greenhouse.io/v1/boards/alpaca/jobs?content=true' },
    { source_id: 'sr-intl-wahed', ats_type: 'lever', feed_url: 'https://api.lever.co/v0/postings/wahed.com?mode=json' },
    { source_id: 'sr-sa-salla', ats_type: 'workable', feed_url: 'https://apply.workable.com/api/v1/widget/accounts/salla?details=true' },
  ],
});

const fetchSourceProvenance = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Source Provenance',
    position: [700, 0],
    executeOnce: true,
    parameters: {
      method: 'GET',
      url: expr(
        "{{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/company_sources?id=in.(sr-qa-scale-ai,sr-sa-alpaca,sr-intl-wahed,sr-sa-salla)&select=id,company_name,review_status,automation_eligibility"
      ),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/json' }] },
      options: { timeout: 15000 },
    },
    credentials: { supabaseApi: newCredential('Supabase Service Role') },
  },
  output: [
    { id: 'sr-qa-scale-ai', company_name: 'Scale AI', review_status: 'verified', automation_eligibility: 'suitable_public_ats' },
  ],
});

const attachProvenanceAndGuard = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Attach Provenance & Guard',
    position: [1000, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        // The graph connects Fetch Source Provenance -> Attach Provenance & Guard
        // directly, so $input here IS Fetch Source Provenance's own output rows
        // (shape { id, company_name, review_status, automation_eligibility }) —
        // never the original 4-source pilot list. The pilot list (source_id,
        // ats_type, feed_url) must instead be read back by name from Load
        // Approved Pilot Sources, which already ran earlier in this execution;
        // n8n's $('NodeName') resolves any already-executed node, not only a
        // direct predecessor.
        "const provenanceRows = $input.all().map(i => i.json);\n" +
        "const provenanceById = new Map(provenanceRows.map(r => [r.id, r]));\n" +
        "\n" +
        "const out = [];\n" +
        "for (const item of $('Load Approved Pilot Sources').all()) {\n" +
        "  const src = item.json;\n" +
        "  const prov = provenanceById.get(src.source_id);\n" +
        "  if (!prov) {\n" +
        "    out.push({ json: { ...src, company_name: null, review_status: null, automation_eligibility: null, approved: false, reviewReason: 'company_sources row not found for source_id' } });\n" +
        "    continue;\n" +
        "  }\n" +
        "  const approved = prov.review_status === 'verified' && prov.automation_eligibility === 'suitable_public_ats';\n" +
        "  out.push({\n" +
        "    json: {\n" +
        "      ...src,\n" +
        "      company_name: prov.company_name,\n" +
        "      review_status: prov.review_status,\n" +
        "      automation_eligibility: prov.automation_eligibility,\n" +
        "      approved,\n" +
        "      reviewReason: approved ? null : ('review_status=' + prov.review_status + ', automation_eligibility=' + prov.automation_eligibility),\n" +
        "    },\n" +
        "  });\n" +
        "}\n" +
        "return out;",
    },
  },
  output: [{ source_id: 'sr-qa-scale-ai', ats_type: 'greenhouse', feed_url: 'https://x', company_name: 'Scale AI', review_status: 'verified', automation_eligibility: 'suitable_public_ats', approved: true, reviewReason: null }],
});

// ─────────────────────────────────────────────────────────────────────────
// Per-source loop
// ─────────────────────────────────────────────────────────────────────────

const processSources = splitInBatches({
  version: 3,
  config: { name: 'Process Sources', position: [1300, 0], parameters: { batchSize: 1 } },
});

const isSourceApproved = ifElse({
  version: 2.3,
  config: {
    name: 'Is Source Approved?',
    position: [1600, 0],
    parameters: {
      // Top-level looseTypeValidation defaults to false at runtime regardless
      // of conditions.options.typeValidation; a bare boolean-true/false
      // operator's unused rightValue ('') then fails strict coercion. Must be
      // explicitly true whenever a condition uses a boolean operator.
      looseTypeValidation: true,
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.approved }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: true }],
        combinator: 'and',
      },
    },
  },
});

const buildReviewRequiredResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Review-Required Result',
    position: [1900, 600],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const items = $input.all();\n" +
        "return items.map(item => {\n" +
        "  const s = item.json;\n" +
        "  return { json: {\n" +
        "    source_id: s.source_id, ats_type: s.ats_type, company_name: s.company_name || null,\n" +
        "    outcome: 'review_required', attempted: true, succeeded: false,\n" +
        "    jobsFetched: 0, jobsValid: 0, jobsRejected: 0,\n" +
        "    jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0, jobsClosed: 0,\n" +
        "    retries: 0, error: s.reviewReason || 'source not approved for automated ingestion',\n" +
        "  } };\n" +
        "});",
    },
  },
  output: [{ source_id: 'sr-x', ats_type: 'greenhouse', company_name: null, outcome: 'review_required', attempted: true, succeeded: false, jobsFetched: 0, jobsValid: 0, jobsRejected: 0, jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0, jobsClosed: 0, retries: 0, error: 'not approved' }],
});

const routeByAtsType = switchCase({
  version: 3.4,
  config: {
    name: 'Route By ATS Type',
    position: [1900, 0],
    parameters: {
      mode: 'rules',
      rules: {
        values: [
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr('{{ $json.ats_type }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'greenhouse' }],
              combinator: 'and',
            },
          },
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr('{{ $json.ats_type }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'lever' }],
              combinator: 'and',
            },
          },
          {
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr('{{ $json.ats_type }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'workable' }],
              combinator: 'and',
            },
          },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Unsupported' },
    },
  },
});

// ── Greenhouse ──────────────────────────────────────────────────────────

const fetchGreenhouseJobs = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Greenhouse Jobs',
    position: [2200, -300],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: expr('{{ $json.feed_url }}'),
      authentication: 'none',
      options: { timeout: 15000, response: { response: { fullResponse: true, neverError: true } } },
    },
  },
  output: [{ statusCode: 200, body: { jobs: [] } }],
});

const evaluateGreenhouseFetchAttempt = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Greenhouse Fetch Attempt',
    position: [2500, -300],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const src = $('Attach Provenance & Guard').item.json;\n" +
        "const inputItem = $input.first().json;\n" +
        "let attempt = 1;\n" +
        "try { attempt = $('Compute Backoff Greenhouse').item.json.attempt; } catch (e) { attempt = 1; }\n" +
        "\n" +
        "const MAX_ATTEMPTS = 4;\n" +
        "const BASE_DELAY_MS = 500;\n" +
        "const MAX_DELAY_MS = 8000;\n" +
        "const RETRYABLE_5XX = new Set([500, 502, 503, 504]);\n" +
        "\n" +
        "function computeBackoffMs(retryAfterMs) {\n" +
        "  if (typeof retryAfterMs === 'number' && retryAfterMs >= 0) return Math.min(MAX_DELAY_MS, retryAfterMs);\n" +
        "  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, attempt - 1));\n" +
        "  const jitter = Math.random() * exp;\n" +
        "  return Math.min(MAX_DELAY_MS, Math.round((exp + jitter) / 2));\n" +
        "}\n" +
        "\n" +
        "function retryableResult(kind, message, retryAfterMs) {\n" +
        "  const canRetry = attempt < MAX_ATTEMPTS;\n" +
        "  return [{ json: {\n" +
        "    source_id: src.source_id, ats_type: src.ats_type, company_name: src.company_name, feed_url: src.feed_url,\n" +
        "    success: false, shouldRetry: canRetry, attempt, nextAttempt: attempt + 1,\n" +
        "    nextDelayMs: canRetry ? computeBackoffMs(retryAfterMs) : null,\n" +
        "    outcome: canRetry ? kind : (kind + '_retries_exhausted'),\n" +
        "    errorMessage: message, statusCode: (inputItem && inputItem.statusCode) || null,\n" +
        "  } }];\n" +
        "}\n" +
        "\n" +
        "function permanentResult(outcome, message, statusCode) {\n" +
        "  return [{ json: {\n" +
        "    source_id: src.source_id, ats_type: src.ats_type, company_name: src.company_name, feed_url: src.feed_url,\n" +
        "    success: false, shouldRetry: false, attempt, outcome, errorMessage: message, statusCode: statusCode || null,\n" +
        "  } }];\n" +
        "}\n" +
        "\n" +
        "if (inputItem && inputItem.error) {\n" +
        "  return retryableResult('retryable_network_error', String(inputItem.error).slice(0, 300), null);\n" +
        "}\n" +
        "\n" +
        "const statusCode = inputItem.statusCode;\n" +
        "if (statusCode === 429) {\n" +
        "  const headers = inputItem.headers || {};\n" +
        "  const retryAfterRaw = headers['retry-after'] || headers['Retry-After'];\n" +
        "  let retryAfterMs = null;\n" +
        "  if (retryAfterRaw != null) {\n" +
        "    const asSeconds = Number(retryAfterRaw);\n" +
        "    if (Number.isFinite(asSeconds) && asSeconds >= 0) {\n" +
        "      retryAfterMs = asSeconds * 1000;\n" +
        "    } else {\n" +
        "      const asDate = Date.parse(retryAfterRaw);\n" +
        "      if (!Number.isNaN(asDate)) retryAfterMs = Math.max(0, asDate - Date.now());\n" +
        "    }\n" +
        "  }\n" +
        "  return retryableResult('retryable_rate_limited', 'HTTP 429 from Greenhouse', retryAfterMs);\n" +
        "}\n" +
        "if (RETRYABLE_5XX.has(statusCode)) {\n" +
        "  return retryableResult('retryable_server_error', 'HTTP ' + statusCode + ' from Greenhouse', null);\n" +
        "}\n" +
        "if (statusCode >= 500) {\n" +
        "  return permanentResult('permanent_server_error', 'HTTP ' + statusCode + ' from Greenhouse', statusCode);\n" +
        "}\n" +
        "if (statusCode >= 400) {\n" +
        "  return permanentResult('permanent_client_error', 'HTTP ' + statusCode + ' from Greenhouse', statusCode);\n" +
        "}\n" +
        "\n" +
        "return [{ json: {\n" +
        "  source_id: src.source_id, ats_type: src.ats_type, company_name: src.company_name, feed_url: src.feed_url,\n" +
        "  success: true, shouldRetry: false, attempt, outcome: 'fetched', statusCode, body: inputItem.body,\n" +
        "} }];",
    },
  },
  output: [{ success: true, shouldRetry: false, attempt: 1, outcome: 'fetched', statusCode: 200, body: { jobs: [] } }],
});

const shouldRetryGreenhouse = ifElse({
  version: 2.3,
  config: {
    name: 'Should Retry Greenhouse?',
    position: [2800, -300],
    parameters: {
      looseTypeValidation: true,
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.shouldRetry }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: true }],
        combinator: 'and',
      },
    },
  },
});

const computeBackoffGreenhouse = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Compute Backoff Greenhouse',
    position: [2800, -150],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const ev = $input.first().json;\n" +
        "return [{ json: { attempt: ev.nextAttempt, nextDelayMs: ev.nextDelayMs, feed_url: ev.feed_url } }];",
    },
  },
  output: [{ attempt: 2, nextDelayMs: 500, feed_url: 'https://x' }],
});

const backoffWaitGreenhouse = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Backoff Wait Greenhouse',
    position: [2800, -50],
    parameters: { resume: 'timeInterval', amount: expr('{{ Math.max(1, Math.round($json.nextDelayMs / 1000)) }}'), unit: 'seconds' },
  },
  output: [{}],
});

const classifyNormalizeGreenhouse = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Classify & Normalize Greenhouse',
    position: [3100, -300],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const src = $('Attach Provenance & Guard').item.json;\n" +
        "const evalResult = $input.first().json;\n" +
        "const retriesUsed = Math.max(0, (evalResult.attempt || 1) - 1);\n" +
        "\n" +
        "if (!evalResult.success) {\n" +
        "  return [{ json: {\n" +
        "    source_id: src.source_id, ats_type: src.ats_type, company_name: src.company_name,\n" +
        "    outcome: evalResult.outcome, attempted: true, succeeded: false,\n" +
        "    jobsFetched: 0, jobsValid: 0, jobsRejected: 0,\n" +
        "    jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0,\n" +
        "    retries: retriesUsed, error: evalResult.errorMessage, normalizedJobs: [],\n" +
        "  } }];\n" +
        "}\n" +
        "\n" +
        "function stripHtml(html) {\n" +
        "  if (!html || typeof html !== 'string') return '';\n" +
        "  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\\s+/g, ' ').trim();\n" +
        "}\n" +
        "\n" +
        "const body = evalResult.body || {};\n" +
        "const rawJobs = Array.isArray(body.jobs) ? body.jobs : [];\n" +
        "const normalized = [];\n" +
        "let rejected = 0;\n" +
        "\n" +
        "for (const job of rawJobs) {\n" +
        "  const externalId = job.id != null ? String(job.id) : null;\n" +
        "  const title = typeof job.title === 'string' ? job.title.trim() : '';\n" +
        "  const applicationUrl = typeof job.absolute_url === 'string' ? job.absolute_url : null;\n" +
        "  const description = stripHtml(job.content);\n" +
        "  const locationName = job.location && typeof job.location.name === 'string' ? job.location.name : null;\n" +
        "\n" +
        "  if (!externalId || !title || !applicationUrl || !/^https?:\\/\\//.test(applicationUrl) || !description) {\n" +
        "    rejected++;\n" +
        "    continue;\n" +
        "  }\n" +
        "\n" +
        "  normalized.push({\n" +
        "    source_type: 'greenhouse', external_id: externalId, title, company_name: src.company_name,\n" +
        "    description, application_method: 'external_link', application_url: applicationUrl, status: 'active',\n" +
        "    location: locationName,\n" +
        "    work_arrangement: locationName && /remote/i.test(locationName) ? 'remote' : null,\n" +
        "    employment_type: null,\n" +
        "    source_id: src.source_id,\n" +
        "    published_at: job.first_published || null,\n" +
        "    source_last_modified_at: job.updated_at || null,\n" +
        "  });\n" +
        "}\n" +
        "\n" +
        "return [{ json: {\n" +
        "  source_id: src.source_id, ats_type: src.ats_type, company_name: src.company_name,\n" +
        "  outcome: 'fetched', attempted: true, succeeded: true,\n" +
        "  jobsFetched: rawJobs.length, jobsValid: normalized.length, jobsRejected: rejected,\n" +
        "  jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0,\n" +
        "  retries: retriesUsed, error: null, normalizedJobs: normalized,\n" +
        "} }];",
    },
  },
  output: [{ source_id: 'sr-qa-scale-ai', ats_type: 'greenhouse', outcome: 'fetched', attempted: true, succeeded: true, jobsFetched: 1, jobsValid: 1, jobsRejected: 0, jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0, retries: 0, error: null, normalizedJobs: [] }],
});

// ── Lever ────────────────────────────────────────────────────────────────

const fetchLeverJobs = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Lever Jobs',
    position: [2200, 0],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: expr('{{ $json.feed_url }}'),
      authentication: 'none',
      options: { timeout: 15000, response: { response: { fullResponse: true, neverError: true } } },
    },
  },
  output: [{ statusCode: 200, body: [] }],
});

const evaluateLeverFetchAttempt = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Lever Fetch Attempt',
    position: [2500, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const src = $('Attach Provenance & Guard').item.json;\n" +
        "const inputItem = $input.first().json;\n" +
        "let attempt = 1;\n" +
        "try { attempt = $('Compute Backoff Lever').item.json.attempt; } catch (e) { attempt = 1; }\n" +
        "\n" +
        "const MAX_ATTEMPTS = 4;\n" +
        "const BASE_DELAY_MS = 500;\n" +
        "const MAX_DELAY_MS = 8000;\n" +
        "const RETRYABLE_5XX = new Set([500, 502, 503, 504]);\n" +
        "\n" +
        "function computeBackoffMs(retryAfterMs) {\n" +
        "  if (typeof retryAfterMs === 'number' && retryAfterMs >= 0) return Math.min(MAX_DELAY_MS, retryAfterMs);\n" +
        "  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, attempt - 1));\n" +
        "  const jitter = Math.random() * exp;\n" +
        "  return Math.min(MAX_DELAY_MS, Math.round((exp + jitter) / 2));\n" +
        "}\n" +
        "\n" +
        "function retryableResult(kind, message, retryAfterMs) {\n" +
        "  const canRetry = attempt < MAX_ATTEMPTS;\n" +
        "  return [{ json: {\n" +
        "    source_id: src.source_id, ats_type: src.ats_type, company_name: src.company_name, feed_url: src.feed_url,\n" +
        "    success: false, shouldRetry: canRetry, attempt, nextAttempt: attempt + 1,\n" +
        "    nextDelayMs: canRetry ? computeBackoffMs(retryAfterMs) : null,\n" +
        "    outcome: canRetry ? kind : (kind + '_retries_exhausted'),\n" +
        "    errorMessage: message, statusCode: (inputItem && inputItem.statusCode) || null,\n" +
        "  } }];\n" +
        "}\n" +
        "\n" +
        "function permanentResult(outcome, message, statusCode) {\n" +
        "  return [{ json: {\n" +
        "    source_id: src.source_id, ats_type: src.ats_type, company_name: src.company_name, feed_url: src.feed_url,\n" +
        "    success: false, shouldRetry: false, attempt, outcome, errorMessage: message, statusCode: statusCode || null,\n" +
        "  } }];\n" +
        "}\n" +
        "\n" +
        "if (inputItem && inputItem.error) {\n" +
        "  return retryableResult('retryable_network_error', String(inputItem.error).slice(0, 300), null);\n" +
        "}\n" +
        "\n" +
        "const statusCode = inputItem.statusCode;\n" +
        "if (statusCode === 429) {\n" +
        "  const headers = inputItem.headers || {};\n" +
        "  const retryAfterRaw = headers['retry-after'] || headers['Retry-After'];\n" +
        "  let retryAfterMs = null;\n" +
        "  if (retryAfterRaw != null) {\n" +
        "    const asSeconds = Number(retryAfterRaw);\n" +
        "    if (Number.isFinite(asSeconds) && asSeconds >= 0) {\n" +
        "      retryAfterMs = asSeconds * 1000;\n" +
        "    } else {\n" +
        "      const asDate = Date.parse(retryAfterRaw);\n" +
        "      if (!Number.isNaN(asDate)) retryAfterMs = Math.max(0, asDate - Date.now());\n" +
        "    }\n" +
        "  }\n" +
        "  return retryableResult('retryable_rate_limited', 'HTTP 429 from Lever', retryAfterMs);\n" +
        "}\n" +
        "if (RETRYABLE_5XX.has(statusCode)) {\n" +
        "  return retryableResult('retryable_server_error', 'HTTP ' + statusCode + ' from Lever', null);\n" +
        "}\n" +
        "if (statusCode >= 500) {\n" +
        "  return permanentResult('permanent_server_error', 'HTTP ' + statusCode + ' from Lever', statusCode);\n" +
        "}\n" +
        "if (statusCode >= 400) {\n" +
        "  return permanentResult('permanent_client_error', 'HTTP ' + statusCode + ' from Lever', statusCode);\n" +
        "}\n" +
        "\n" +
        "return [{ json: {\n" +
        "  source_id: src.source_id, ats_type: src.ats_type, company_name: src.company_name, feed_url: src.feed_url,\n" +
        "  success: true, shouldRetry: false, attempt, outcome: 'fetched', statusCode, body: inputItem.body,\n" +
        "} }];",
    },
  },
  output: [{ success: true, shouldRetry: false, attempt: 1, outcome: 'fetched', statusCode: 200, body: [] }],
});

const shouldRetryLever = ifElse({
  version: 2.3,
  config: {
    name: 'Should Retry Lever?',
    position: [2800, 0],
    parameters: {
      looseTypeValidation: true,
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.shouldRetry }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: true }],
        combinator: 'and',
      },
    },
  },
});

const computeBackoffLever = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Compute Backoff Lever',
    position: [2800, 150],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const ev = $input.first().json;\n" +
        "return [{ json: { attempt: ev.nextAttempt, nextDelayMs: ev.nextDelayMs, feed_url: ev.feed_url } }];",
    },
  },
  output: [{ attempt: 2, nextDelayMs: 500, feed_url: 'https://x' }],
});

const backoffWaitLever = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Backoff Wait Lever',
    position: [2800, 250],
    parameters: { resume: 'timeInterval', amount: expr('{{ Math.max(1, Math.round($json.nextDelayMs / 1000)) }}'), unit: 'seconds' },
  },
  output: [{}],
});

const classifyNormalizeLever = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Classify & Normalize Lever',
    position: [3100, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const src = $('Attach Provenance & Guard').item.json;\n" +
        "const evalResult = $input.first().json;\n" +
        "const retriesUsed = Math.max(0, (evalResult.attempt || 1) - 1);\n" +
        "\n" +
        "if (!evalResult.success) {\n" +
        "  return [{ json: {\n" +
        "    source_id: src.source_id, ats_type: src.ats_type, company_name: src.company_name,\n" +
        "    outcome: evalResult.outcome, attempted: true, succeeded: false,\n" +
        "    jobsFetched: 0, jobsValid: 0, jobsRejected: 0,\n" +
        "    jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0,\n" +
        "    retries: retriesUsed, error: evalResult.errorMessage, normalizedJobs: [],\n" +
        "  } }];\n" +
        "}\n" +
        "\n" +
        "const EMPLOYMENT_MAP = { 'full-time': 'full-time', 'part-time': 'part-time', contract: 'contract', contractual: 'contract', internship: 'internship' };\n" +
        "const WORKPLACE_MAP = { remote: 'remote', 'on-site': 'onsite', onsite: 'onsite', hybrid: 'hybrid' };\n" +
        "\n" +
        "const rawJobs = Array.isArray(evalResult.body) ? evalResult.body : [];\n" +
        "const normalized = [];\n" +
        "let rejected = 0;\n" +
        "\n" +
        "for (const job of rawJobs) {\n" +
        "  const externalId = typeof job.id === 'string' ? job.id : null;\n" +
        "  const title = typeof job.text === 'string' ? job.text.trim() : '';\n" +
        "  const applicationUrl = job.applyUrl || job.hostedUrl || null;\n" +
        "  const description = (typeof job.descriptionPlain === 'string' && job.descriptionPlain.trim()) ? job.descriptionPlain.trim() : '';\n" +
        "\n" +
        "  if (!externalId || !title || !applicationUrl || !/^https?:\\/\\//.test(applicationUrl) || !description) {\n" +
        "    rejected++;\n" +
        "    continue;\n" +
        "  }\n" +
        "\n" +
        "  const commitment = job.categories && typeof job.categories.commitment === 'string' ? job.categories.commitment.toLowerCase() : null;\n" +
        "  const workplaceType = job.categories && typeof job.categories.workplaceType === 'string' ? job.categories.workplaceType.toLowerCase() : null;\n" +
        "\n" +
        "  normalized.push({\n" +
        "    source_type: 'lever', external_id: externalId, title, company_name: src.company_name,\n" +
        "    description, application_method: 'external_link', application_url: applicationUrl, status: 'active',\n" +
        "    location: (job.categories && job.categories.location) || null,\n" +
        "    work_arrangement: workplaceType && WORKPLACE_MAP[workplaceType] ? WORKPLACE_MAP[workplaceType] : null,\n" +
        "    employment_type: commitment && EMPLOYMENT_MAP[commitment] ? EMPLOYMENT_MAP[commitment] : null,\n" +
        "    source_id: src.source_id,\n" +
        "    published_at: typeof job.createdAt === 'number' ? new Date(job.createdAt).toISOString() : null,\n" +
        "    source_last_modified_at: null,\n" +
        "  });\n" +
        "}\n" +
        "\n" +
        "return [{ json: {\n" +
        "  source_id: src.source_id, ats_type: src.ats_type, company_name: src.company_name,\n" +
        "  outcome: 'fetched', attempted: true, succeeded: true,\n" +
        "  jobsFetched: rawJobs.length, jobsValid: normalized.length, jobsRejected: rejected,\n" +
        "  jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0,\n" +
        "  retries: retriesUsed, error: null, normalizedJobs: normalized,\n" +
        "} }];",
    },
  },
  output: [{ source_id: 'sr-intl-wahed', ats_type: 'lever', outcome: 'fetched', attempted: true, succeeded: true, jobsFetched: 1, jobsValid: 1, jobsRejected: 0, jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0, retries: 0, error: null, normalizedJobs: [] }],
});

// ── Workable ─────────────────────────────────────────────────────────────

const fetchWorkableJobs = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Workable Jobs',
    position: [2200, 300],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: expr('{{ $json.feed_url }}'),
      authentication: 'none',
      options: { timeout: 15000, response: { response: { fullResponse: true, neverError: true } } },
    },
  },
  output: [{ statusCode: 200, body: { jobs: [] } }],
});

const evaluateWorkableFetchAttempt = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Workable Fetch Attempt',
    position: [2500, 300],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const src = $('Attach Provenance & Guard').item.json;\n" +
        "const inputItem = $input.first().json;\n" +
        "let attempt = 1;\n" +
        "try { attempt = $('Compute Backoff Workable').item.json.attempt; } catch (e) { attempt = 1; }\n" +
        "\n" +
        "const MAX_ATTEMPTS = 4;\n" +
        "const BASE_DELAY_MS = 500;\n" +
        "const MAX_DELAY_MS = 8000;\n" +
        "const RETRYABLE_5XX = new Set([500, 502, 503, 504]);\n" +
        "\n" +
        "function computeBackoffMs(retryAfterMs) {\n" +
        "  if (typeof retryAfterMs === 'number' && retryAfterMs >= 0) return Math.min(MAX_DELAY_MS, retryAfterMs);\n" +
        "  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, attempt - 1));\n" +
        "  const jitter = Math.random() * exp;\n" +
        "  return Math.min(MAX_DELAY_MS, Math.round((exp + jitter) / 2));\n" +
        "}\n" +
        "\n" +
        "function retryableResult(kind, message, retryAfterMs) {\n" +
        "  const canRetry = attempt < MAX_ATTEMPTS;\n" +
        "  return [{ json: {\n" +
        "    source_id: src.source_id, ats_type: src.ats_type, company_name: src.company_name, feed_url: src.feed_url,\n" +
        "    success: false, shouldRetry: canRetry, attempt, nextAttempt: attempt + 1,\n" +
        "    nextDelayMs: canRetry ? computeBackoffMs(retryAfterMs) : null,\n" +
        "    outcome: canRetry ? kind : (kind + '_retries_exhausted'),\n" +
        "    errorMessage: message, statusCode: (inputItem && inputItem.statusCode) || null,\n" +
        "  } }];\n" +
        "}\n" +
        "\n" +
        "function permanentResult(outcome, message, statusCode) {\n" +
        "  return [{ json: {\n" +
        "    source_id: src.source_id, ats_type: src.ats_type, company_name: src.company_name, feed_url: src.feed_url,\n" +
        "    success: false, shouldRetry: false, attempt, outcome, errorMessage: message, statusCode: statusCode || null,\n" +
        "  } }];\n" +
        "}\n" +
        "\n" +
        "if (inputItem && inputItem.error) {\n" +
        "  return retryableResult('retryable_network_error', String(inputItem.error).slice(0, 300), null);\n" +
        "}\n" +
        "\n" +
        "const statusCode = inputItem.statusCode;\n" +
        "if (statusCode === 429) {\n" +
        "  const headers = inputItem.headers || {};\n" +
        "  const retryAfterRaw = headers['retry-after'] || headers['Retry-After'];\n" +
        "  let retryAfterMs = null;\n" +
        "  if (retryAfterRaw != null) {\n" +
        "    const asSeconds = Number(retryAfterRaw);\n" +
        "    if (Number.isFinite(asSeconds) && asSeconds >= 0) {\n" +
        "      retryAfterMs = asSeconds * 1000;\n" +
        "    } else {\n" +
        "      const asDate = Date.parse(retryAfterRaw);\n" +
        "      if (!Number.isNaN(asDate)) retryAfterMs = Math.max(0, asDate - Date.now());\n" +
        "    }\n" +
        "  }\n" +
        "  return retryableResult('retryable_rate_limited', 'HTTP 429 from Workable', retryAfterMs);\n" +
        "}\n" +
        "if (RETRYABLE_5XX.has(statusCode)) {\n" +
        "  return retryableResult('retryable_server_error', 'HTTP ' + statusCode + ' from Workable', null);\n" +
        "}\n" +
        "if (statusCode >= 500) {\n" +
        "  return permanentResult('permanent_server_error', 'HTTP ' + statusCode + ' from Workable', statusCode);\n" +
        "}\n" +
        "if (statusCode >= 400) {\n" +
        "  return permanentResult('permanent_client_error', 'HTTP ' + statusCode + ' from Workable', statusCode);\n" +
        "}\n" +
        "\n" +
        "return [{ json: {\n" +
        "  source_id: src.source_id, ats_type: src.ats_type, company_name: src.company_name, feed_url: src.feed_url,\n" +
        "  success: true, shouldRetry: false, attempt, outcome: 'fetched', statusCode, body: inputItem.body,\n" +
        "} }];",
    },
  },
  output: [{ success: true, shouldRetry: false, attempt: 1, outcome: 'fetched', statusCode: 200, body: { jobs: [] } }],
});

const shouldRetryWorkable = ifElse({
  version: 2.3,
  config: {
    name: 'Should Retry Workable?',
    position: [2800, 300],
    parameters: {
      looseTypeValidation: true,
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.shouldRetry }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: true }],
        combinator: 'and',
      },
    },
  },
});

const computeBackoffWorkable = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Compute Backoff Workable',
    position: [2800, 450],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const ev = $input.first().json;\n" +
        "return [{ json: { attempt: ev.nextAttempt, nextDelayMs: ev.nextDelayMs, feed_url: ev.feed_url } }];",
    },
  },
  output: [{ attempt: 2, nextDelayMs: 500, feed_url: 'https://x' }],
});

const backoffWaitWorkable = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Backoff Wait Workable',
    position: [2800, 550],
    parameters: { resume: 'timeInterval', amount: expr('{{ Math.max(1, Math.round($json.nextDelayMs / 1000)) }}'), unit: 'seconds' },
  },
  output: [{}],
});

const classifyNormalizeWorkable = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Classify & Normalize Workable',
    position: [3100, 300],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const src = $('Attach Provenance & Guard').item.json;\n" +
        "const evalResult = $input.first().json;\n" +
        "const retriesUsed = Math.max(0, (evalResult.attempt || 1) - 1);\n" +
        "\n" +
        "if (!evalResult.success) {\n" +
        "  return [{ json: {\n" +
        "    source_id: src.source_id, ats_type: src.ats_type, company_name: src.company_name,\n" +
        "    outcome: evalResult.outcome, attempted: true, succeeded: false,\n" +
        "    jobsFetched: 0, jobsValid: 0, jobsRejected: 0,\n" +
        "    jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0,\n" +
        "    retries: retriesUsed, error: evalResult.errorMessage, normalizedJobs: [],\n" +
        "  } }];\n" +
        "}\n" +
        "\n" +
        "function stripHtml(html) {\n" +
        "  if (!html || typeof html !== 'string') return '';\n" +
        "  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\\s+/g, ' ').trim();\n" +
        "}\n" +
        "\n" +
        "const EMPLOYMENT_MAP = { 'full-time': 'full-time', 'part-time': 'part-time', contract: 'contract', internship: 'internship' };\n" +
        "\n" +
        "const body = evalResult.body || {};\n" +
        "const rawJobs = Array.isArray(body.jobs) ? body.jobs : [];\n" +
        "const normalized = [];\n" +
        "let rejected = 0;\n" +
        "\n" +
        "for (const job of rawJobs) {\n" +
        "  const externalId = typeof job.shortcode === 'string' ? job.shortcode : null;\n" +
        "  const title = typeof job.title === 'string' ? job.title.trim() : '';\n" +
        "  const applicationUrl = job.application_url || job.url || null;\n" +
        "  const description = stripHtml(job.description);\n" +
        "\n" +
        "  if (!externalId || !title || !applicationUrl || !/^https?:\\/\\//.test(applicationUrl) || !description) {\n" +
        "    rejected++;\n" +
        "    continue;\n" +
        "  }\n" +
        "\n" +
        "  const empType = typeof job.employment_type === 'string' ? job.employment_type.toLowerCase() : null;\n" +
        "  const locationParts = [job.city, job.country].filter(v => typeof v === 'string' && v.trim());\n" +
        "\n" +
        "  normalized.push({\n" +
        "    source_type: 'workable', external_id: externalId, title, company_name: src.company_name,\n" +
        "    description, application_method: 'external_link', application_url: applicationUrl, status: 'active',\n" +
        "    location: locationParts.length ? locationParts.join(', ') : null,\n" +
        "    work_arrangement: job.telecommuting === true ? 'remote' : null,\n" +
        "    employment_type: empType && EMPLOYMENT_MAP[empType] ? EMPLOYMENT_MAP[empType] : null,\n" +
        "    source_id: src.source_id,\n" +
        "    published_at: (typeof job.published_on === 'string' && job.published_on) ? new Date(job.published_on).toISOString() : null,\n" +
        "    source_last_modified_at: null,\n" +
        "  });\n" +
        "}\n" +
        "\n" +
        "return [{ json: {\n" +
        "  source_id: src.source_id, ats_type: src.ats_type, company_name: src.company_name,\n" +
        "  outcome: 'fetched', attempted: true, succeeded: true,\n" +
        "  jobsFetched: rawJobs.length, jobsValid: normalized.length, jobsRejected: rejected,\n" +
        "  jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0,\n" +
        "  retries: retriesUsed, error: null, normalizedJobs: normalized,\n" +
        "} }];",
    },
  },
  output: [{ source_id: 'sr-sa-salla', ats_type: 'workable', outcome: 'fetched', attempted: true, succeeded: true, jobsFetched: 1, jobsValid: 1, jobsRejected: 0, jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0, retries: 0, error: null, normalizedJobs: [] }],
});

const buildUnsupportedAtsResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Unsupported ATS Result',
    position: [2200, 600],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const items = $input.all();\n" +
        "return items.map(item => {\n" +
        "  const s = item.json;\n" +
        "  return { json: {\n" +
        "    source_id: s.source_id, ats_type: s.ats_type, company_name: s.company_name || null,\n" +
        "    outcome: 'permanent_unsupported_ats', attempted: true, succeeded: false,\n" +
        "    jobsFetched: 0, jobsValid: 0, jobsRejected: 0, jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0, jobsClosed: 0,\n" +
        "    retries: 0, error: 'Unsupported ats_type: ' + s.ats_type,\n" +
        "  } };\n" +
        "});",
    },
  },
  output: [{ source_id: 'sr-x', ats_type: 'unknown', company_name: null, outcome: 'permanent_unsupported_ats', attempted: true, succeeded: false, jobsFetched: 0, jobsValid: 0, jobsRejected: 0, jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0, jobsClosed: 0, retries: 0, error: 'Unsupported ats_type: unknown' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Bounded local_pilot database write (idempotent upsert + stale-close)
// ─────────────────────────────────────────────────────────────────────────

const shouldWriteToDb = ifElse({
  version: 2.3,
  config: {
    name: 'Should Write To DB?',
    position: [3400, 0],
    parameters: {
      looseTypeValidation: true,
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          { leftValue: expr('{{ $json.succeeded }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: true },
          { leftValue: expr('{{ $json.jobsValid }}'), operator: { type: 'number', operation: 'gt' }, rightValue: 0 },
          { leftValue: expr("{{ $('Workflow Configuration').first().json.mode }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'local_pilot' },
        ],
        combinator: 'and',
      },
    },
  },
});

const prepareBoundedWriteSet = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Bounded Write Set',
    position: [3700, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const cfg = $('Workflow Configuration').first().json;\n" +
        "const cap = typeof cfg.maxJobsPerSource === 'number' ? cfg.maxJobsPerSource : 5;\n" +
        "const j = $input.first().json;\n" +
        "// Some ATS list endpoints (observed live on Workable) return the same\n" +
        "// job twice (e.g. cross-listed under multiple categories) with an\n" +
        "// identical external_id. A single upsert statement with on_conflict\n" +
        "// cannot affect the same conflict-key row twice (\"ON CONFLICT DO UPDATE\n" +
        "// command cannot affect row a second time\"), so duplicates must be\n" +
        "// collapsed before capping, keeping the first occurrence.\n" +
        "const seenExternalIds = new Set();\n" +
        "const dedupedJobs = [];\n" +
        "for (const job of j.normalizedJobs) {\n" +
        "  if (seenExternalIds.has(job.external_id)) continue;\n" +
        "  seenExternalIds.add(job.external_id);\n" +
        "  dedupedJobs.push(job);\n" +
        "}\n" +
        "const boundedJobs = dedupedJobs.slice(0, cap);\n" +
        "// A bounded/truncated pilot result (more valid jobs existed at the source\n" +
        "// than the cap allowed us to write) must never be treated as a complete\n" +
        "// snapshot — stale-close is gated on !truncated downstream (Should Close\n" +
        "// Stale Jobs?) so a partial fetch can never mark real, still-active jobs\n" +
        "// unavailable just because this run only wrote the first `cap` of them.\n" +
        "const truncated = dedupedJobs.length > cap;\n" +
        "return [{ json: {\n" +
        "  source_id: j.source_id, ats_type: j.ats_type, company_name: j.company_name,\n" +
        "  outcome: j.outcome, succeeded: j.succeeded,\n" +
        "  jobsFetched: j.jobsFetched, jobsValid: j.jobsValid, jobsRejected: j.jobsRejected,\n" +
        "  retries: j.retries, error: j.error,\n" +
        "  boundedJobs, truncated,\n" +
        "  externalIdList: boundedJobs.map(x => x.external_id),\n" +
        "} }];",
    },
  },
  output: [{ source_id: 'sr-x', ats_type: 'greenhouse', outcome: 'fetched', succeeded: true, jobsFetched: 1, jobsValid: 1, jobsRejected: 0, retries: 0, error: null, boundedJobs: [], externalIdList: [] }],
});

const selectExistingJobsForSource = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Select Existing Jobs For Source',
    position: [4000, 0],
    parameters: {
      method: 'GET',
      url: expr(
        "{{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/jobs?source_id=eq.{{ $json.source_id }}&status=eq.active&select=external_id,first_seen_at,title,description,application_url,location,work_arrangement,employment_type"
      ),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/json' }] },
      options: { timeout: 15000 },
    },
    alwaysOutputData: true,
    credentials: { supabaseApi: newCredential('Supabase Service Role') },
  },
  output: [[]],
});

const computeDiffPlan = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Compute Diff Plan',
    position: [4300, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const prepared = $('Prepare Bounded Write Set').item.json;\n" +
        "const boundedJobs = prepared.boundedJobs;\n" +
        "const fetchedIdSet = new Set(boundedJobs.map(j => j.external_id));\n" +
        "\n" +
        "// Select Existing Jobs For Source has no fullResponse wrapping, so n8n\n" +
        "// auto-splits its JSON array response into one output item per row (the\n" +
        "// same behavior that affected Attach Provenance & Guard) — .all() is\n" +
        "// required, never .first(), or only one existing row is ever seen\n" +
        "// regardless of how many are actually active for this source. When zero\n" +
        "// rows match, alwaysOutputData:true still emits a single placeholder item\n" +
        "// with no external_id, which the filter below excludes.\n" +
        "const existingRows = $input.all().map(i => i.json).filter(r => r && r.external_id);\n" +
        "const existingByExtId = new Map(existingRows.map(r => [r.external_id, r]));\n" +
        "\n" +
        "let created = 0, updated = 0, unchanged = 0;\n" +
        "const nowIso = new Date().toISOString();\n" +
        "const upsertPayload = boundedJobs.map(job => {\n" +
        "  const existing = existingByExtId.get(job.external_id);\n" +
        "  if (!existing) {\n" +
        "    created++;\n" +
        "    return { ...job, first_seen_at: nowIso, last_seen_at: nowIso, last_checked_at: nowIso, last_successful_check_at: nowIso };\n" +
        "  }\n" +
        "  const changed = existing.title !== job.title || existing.description !== job.description\n" +
        "    || existing.application_url !== job.application_url || existing.location !== job.location\n" +
        "    || existing.work_arrangement !== job.work_arrangement || existing.employment_type !== job.employment_type;\n" +
        "  if (changed) updated++; else unchanged++;\n" +
        "  return { ...job, first_seen_at: existing.first_seen_at, last_seen_at: nowIso, last_checked_at: nowIso, last_successful_check_at: nowIso };\n" +
        "});\n" +
        "\n" +
        "const staleExternalIds = existingRows.map(r => r.external_id).filter(extId => !fetchedIdSet.has(extId));\n" +
        "\n" +
        "return [{ json: { ...prepared, upsertPayload, diffCreated: created, diffUpdated: updated, diffUnchanged: unchanged, staleExternalIds } }];",
    },
  },
  output: [{ source_id: 'sr-x', ats_type: 'greenhouse', outcome: 'fetched', succeeded: true, jobsFetched: 1, jobsValid: 1, jobsRejected: 0, retries: 0, error: null, boundedJobs: [], externalIdList: [], upsertPayload: [], diffCreated: 0, diffUpdated: 0, diffUnchanged: 0, staleExternalIds: [] }],
});

const upsertJobs = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Upsert Jobs',
    position: [4600, 0],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/jobs?on_conflict=dedup_scope,external_id"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Prefer', value: 'resolution=merge-duplicates,return=minimal' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr('={{ $json.upsertPayload }}'),
      options: { timeout: 15000 },
    },
    credentials: { supabaseApi: newCredential('Supabase Service Role') },
  },
  output: [{}],
});

const mergeUpsertResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Merge Upsert Result',
    position: [4900, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const plan = $('Compute Diff Plan').item.json;\n" +
        "const resultRaw = $input.first().json;\n" +
        "if (resultRaw && resultRaw.error) {\n" +
        "  return [{ json: { ...plan, writeSucceeded: false, jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0, writeError: String(resultRaw.error).slice(0, 300) } }];\n" +
        "}\n" +
        "return [{ json: { ...plan, writeSucceeded: true, jobsCreated: plan.diffCreated, jobsUpdated: plan.diffUpdated, jobsUnchanged: plan.diffUnchanged, writeError: null } }];",
    },
  },
  output: [{ source_id: 'sr-x', writeSucceeded: true, jobsCreated: 1, jobsUpdated: 0, jobsUnchanged: 0, writeError: null, staleExternalIds: [] }],
});

const shouldCloseStaleJobs = ifElse({
  version: 2.3,
  config: {
    name: 'Should Close Stale Jobs?',
    position: [5200, 0],
    parameters: {
      looseTypeValidation: true,
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          { leftValue: expr('{{ $json.writeSucceeded }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: true },
          { leftValue: expr('{{ $json.staleExternalIds.length }}'), operator: { type: 'number', operation: 'gt' }, rightValue: 0 },
          { leftValue: expr('{{ $json.truncated }}'), operator: { type: 'boolean', operation: 'false' }, rightValue: false },
        ],
        combinator: 'and',
      },
    },
  },
});

const closeStaleJobsForSource = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Close Stale Jobs For Source',
    position: [5500, -180],
    onError: 'continueRegularOutput',
    alwaysOutputData: true,
    parameters: {
      method: 'PATCH',
      url: expr(
        "{{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/jobs?source_id=eq.{{ $json.source_id }}&external_id=in.({{ $json.staleExternalIds.join(',') }})"
      ),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Prefer', value: 'return=minimal' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: { status: 'unavailable', status_reason: 'Not present in latest pilot ingestion run (source fetch succeeded)' },
      options: { timeout: 15000 },
    },
    credentials: { supabaseApi: newCredential('Supabase Service Role') },
  },
  output: [{}],
});

// ─────────────────────────────────────────────────────────────────────────
// Convergence + pacing
// ─────────────────────────────────────────────────────────────────────────

const finalizeSourceResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Finalize Source Result',
    position: [5800, 200],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const items = $input.all();\n" +
        "const out = [];\n" +
        "for (const item of items) {\n" +
        "  let j;\n" +
        "  try {\n" +
        "    j = $('Merge Upsert Result').item.json;\n" +
        "  } catch (e) {\n" +
        "    j = item.json;\n" +
        "  }\n" +
        "  out.push({ json: {\n" +
        "    source_id: j.source_id, ats_type: j.ats_type, company_name: j.company_name || null,\n" +
        "    outcome: j.writeSucceeded === false ? 'db_write_failed' : (j.outcome || 'unknown'),\n" +
        "    attempted: true,\n" +
        "    succeeded: j.writeSucceeded !== false && j.succeeded !== false,\n" +
        "    jobsFetched: j.jobsFetched || 0, jobsValid: j.jobsValid || 0, jobsRejected: j.jobsRejected || 0,\n" +
        "    jobsCreated: j.jobsCreated || 0, jobsUpdated: j.jobsUpdated || 0, jobsUnchanged: j.jobsUnchanged || 0,\n" +
        "    jobsClosed: Array.isArray(j.staleExternalIds) ? j.staleExternalIds.length : 0,\n" +
        "    retries: j.retries || 0,\n" +
        "    error: j.writeError || j.error || null,\n" +
        "    truncated: j.truncated === true,\n" +
        "  } });\n" +
        "}\n" +
        "return out;",
    },
  },
  output: [{ source_id: 'sr-x', ats_type: 'greenhouse', company_name: 'X', outcome: 'fetched', attempted: true, succeeded: true, jobsFetched: 1, jobsValid: 1, jobsRejected: 0, jobsCreated: 1, jobsUpdated: 0, jobsUnchanged: 0, jobsClosed: 0, retries: 0, error: null }],
});

const rateLimitDelay = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Rate Limit Delay',
    position: [6100, 200],
    parameters: {
      resume: 'timeInterval',
      amount: expr("{{ $('Workflow Configuration').first().json.rateLimitDelaySeconds }}"),
      unit: 'seconds',
    },
  },
  output: [{}],
});

const buildExecutionSummary = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Execution Summary',
    position: [6100, -700],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const cfg = $('Workflow Configuration').first().json;\n" +
        "const results = $input.all().map(i => i.json);\n" +
        "const sum = (key) => results.reduce((acc, r) => acc + (r[key] || 0), 0);\n" +
        "\n" +
        "const startedAtMs = new Date(cfg.startedAt).getTime();\n" +
        "\n" +
        "return [{ json: {\n" +
        "  mode: cfg.mode,\n" +
        "  environment: cfg.environment,\n" +
        "  sourcesAttempted: results.length,\n" +
        "  sourcesSucceeded: results.filter(r => r.succeeded).length,\n" +
        "  sourcesFailed: results.filter(r => !r.succeeded).length,\n" +
        "  jobsFetched: sum('jobsFetched'),\n" +
        "  jobsValid: sum('jobsValid'),\n" +
        "  jobsRejected: sum('jobsRejected'),\n" +
        "  jobsCreated: sum('jobsCreated'),\n" +
        "  jobsUpdated: sum('jobsUpdated'),\n" +
        "  jobsUnchanged: sum('jobsUnchanged'),\n" +
        "  jobsClosed: sum('jobsClosed'),\n" +
        "  retries: sum('retries'),\n" +
        "  totalDurationMs: Date.now() - startedAtMs,\n" +
        "  perSource: results,\n" +
        "  finishedAt: new Date().toISOString(),\n" +
        "} }];",
    },
  },
  output: [{ mode: 'dry_run', environment: 'local', sourcesAttempted: 4, sourcesSucceeded: 4, sourcesFailed: 0, jobsFetched: 4, jobsValid: 4, jobsRejected: 0, jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0, jobsClosed: 0, retries: 0, totalDurationMs: 1000, perSource: [], finishedAt: '2026-09-15T00:00:00.000Z' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Sticky notes
// ─────────────────────────────────────────────────────────────────────────

const overviewNote = sticky(
  '### Job Ingestion — Pilot Orchestrator\n' +
    'Manual, controlled pilot over 4 pre-verified sources (Greenhouse x2, Lever, Workable). ' +
    'Set mode to dry_run (no DB writes) or local_pilot (bounded DB writes) in Workflow Configuration. ' +
    'No Schedule Trigger in this phase. See docs/job-ingestion-pilot.md.',
  [startTrigger, workflowConfiguration],
  { color: 6 }
);

const retryLimitationNote = sticky(
  '### Bounded exponential backoff + jitter\n' +
    'Each adapter loops Fetch → Evaluate → Should Retry? → (Compute Backoff → Wait → back to Fetch). ' +
    'Only timeouts/connection errors, HTTP 429, and retryable 5xx (500/502/503/504) retry — up to 4 attempts total, ' +
    'delay = exponential capped at 8s + jitter, or a valid Retry-After on 429. ' +
    'Permanent 4xx and non-retryable 5xx never retry. Real retry count and final classification ' +
    'are exposed per source in the run summary (retries / outcome).',
  [fetchGreenhouseJobs, fetchLeverJobs, fetchWorkableJobs],
  { color: 4 }
);

// ─────────────────────────────────────────────────────────────────────────
// Architecture documentation notes (canvas cleanup pass — presentation only,
// no execution logic touched). Positions are explicit, not anchor-derived,
// so they stay pixel-identical to what was applied live via update_workflow
// addNode ops — verified non-overlapping against every existing node and
// sticky's bounding box before being placed.
// ─────────────────────────────────────────────────────────────────────────

const adapterArchitectureNote = node({
  type: 'n8n-nodes-base.stickyNote',
  version: 1,
  config: {
    name: 'Sticky Note - Adapter Architecture',
    position: [1550, -380],
    parameters: {
      content:
        '### Adapter Architecture (future direction)\n' +
        'This workflow should evolve from provider-specific branches into a provider-agnostic ingestion framework. ' +
        'Greenhouse/Lever/Workable are the first three adapters, not the ceiling — Oracle, SAP, HTML extraction, and custom parsers ' +
        'are expected to plug into the same fetch -> normalize -> validate -> write pipeline. Do not assume this switch/branch shape is the final architecture.',
      height: 220,
      width: 480,
      color: 3,
    },
  },
  output: [{}],
});

const normalizationContractNote = node({
  type: 'n8n-nodes-base.stickyNote',
  version: 1,
  config: {
    name: 'Sticky Note - Normalization Contract',
    position: [3104, 480],
    parameters: {
      content:
        '### Shared Normalization Contract\n' +
        'All providers must output into the same normalized job shape before reaching Should Write To DB? — external_id, title, description, ' +
        'application_url, location, work_arrangement, employment_type, source_id, published_at. An adapter is done only when it produces this exact shape; ' +
        'provider-specific fields must never leak downstream of Classify & Normalize.',
      height: 200,
      width: 480,
      color: 3,
    },
  },
  output: [{}],
});

const sourceRegistryNote = node({
  type: 'n8n-nodes-base.stickyNote',
  version: 1,
  config: {
    name: 'Sticky Note - Source Registry Direction',
    position: [400, 220],
    parameters: {
      content:
        '### Source Registry Direction\n' +
        'Load Approved Pilot Sources is a hardcoded 4-row list for this pilot only. Future execution should be driven by source configuration ' +
        '(company_sources) instead of a hardcoded provider list — Attach Provenance & Guard already re-checks review_status/automation_eligibility live ' +
        'from the database on every run; that pattern is what a registry-driven version should extend, not replace.',
      height: 200,
      width: 520,
      color: 3,
    },
  },
  output: [{}],
});

const safetyInvariantsNote = node({
  type: 'n8n-nodes-base.stickyNote',
  version: 1,
  config: {
    name: 'Sticky Note - Safety Invariants',
    position: [1030, -380],
    parameters: {
      content:
        '### Safety Invariants — keep these when extending\n' +
        'dry_run support, bounded writes (maxJobsPerSource), retry/backoff limits, per-source approval (review_status + automation_eligibility), ' +
        'and source-scoped stale-close are load-bearing safety mechanisms, not pilot-only scaffolding. Any new adapter or future scheduled version ' +
        'must preserve all five before activation.',
      height: 220,
      width: 480,
      color: 3,
    },
  },
  output: [{}],
});

const futureTargetArchitectureNote = node({
  type: 'n8n-nodes-base.stickyNote',
  version: 1,
  config: {
    name: 'Sticky Note - Future Target Architecture',
    position: [100, 950],
    parameters: {
      content:
        '### Future Target Architecture (not yet implemented)\n' +
        'Source Registry -> Ingestion Orchestrator -> Adapter Selection -> Fetch -> Normalize -> Validate -> Write.\n\n' +
        'The current Greenhouse/Lever/Workable branches are the first concrete adapter implementations of this shape: Route By ATS Type is today\'s ' +
        '"Adapter Selection", and Classify & Normalize <ATS> is today\'s "Normalize". This note documents the target direction only — no refactor has ' +
        'been implemented, and this pilot\'s execution logic is unchanged.',
      height: 320,
      width: 750,
      color: 5,
    },
  },
  output: [{}],
});

// ─────────────────────────────────────────────────────────────────────────
// Wiring
// ─────────────────────────────────────────────────────────────────────────

// finalizeSourceResult is the single convergence point for every terminal
// branch of a source iteration; its own downstream wiring (rate-limit pause,
// then loop back for the next source) is declared once here and reused as
// the `.to()` target from every branch below.
const finalizeThenNextBatch = finalizeSourceResult.to(rateLimitDelay.to(nextBatch(processSources)));

const dbWriteChain = shouldWriteToDb
  .onFalse(finalizeThenNextBatch)
  .onTrue(
    prepareBoundedWriteSet.to(
      selectExistingJobsForSource.to(
        computeDiffPlan.to(
          upsertJobs.to(
            mergeUpsertResult.to(
              shouldCloseStaleJobs
                .onFalse(finalizeThenNextBatch)
                .onTrue(closeStaleJobsForSource.to(finalizeThenNextBatch))
            )
          )
        )
      )
    )
  );

// Each adapter's retry sub-loop: Fetch → Evaluate → Should Retry? →
//   true:  Compute Backoff → Wait → back to the SAME Fetch node
//   false: Classify & Normalize → dbWriteChain
fetchGreenhouseJobs.to(
  evaluateGreenhouseFetchAttempt.to(
    shouldRetryGreenhouse
      .onTrue(computeBackoffGreenhouse.to(backoffWaitGreenhouse.to(fetchGreenhouseJobs)))
      .onFalse(classifyNormalizeGreenhouse.to(dbWriteChain))
  )
);

fetchLeverJobs.to(
  evaluateLeverFetchAttempt.to(
    shouldRetryLever
      .onTrue(computeBackoffLever.to(backoffWaitLever.to(fetchLeverJobs)))
      .onFalse(classifyNormalizeLever.to(dbWriteChain))
  )
);

fetchWorkableJobs.to(
  evaluateWorkableFetchAttempt.to(
    shouldRetryWorkable
      .onTrue(computeBackoffWorkable.to(backoffWaitWorkable.to(fetchWorkableJobs)))
      .onFalse(classifyNormalizeWorkable.to(dbWriteChain))
  )
);

const sourceLoopBody = isSourceApproved
  .onFalse(buildReviewRequiredResult.to(finalizeThenNextBatch))
  .onTrue(
    routeByAtsType
      .onCase(0, fetchGreenhouseJobs)
      .onCase(1, fetchLeverJobs)
      .onCase(2, fetchWorkableJobs)
      .onCase(3, buildUnsupportedAtsResult.to(finalizeThenNextBatch))
  );

export default workflow('job-ingestion-pilot-orchestrator', 'Job Ingestion — Pilot Orchestrator')
  .add(startTrigger)
  .to(
    workflowConfiguration.to(
      loadApprovedPilotSources.to(
        fetchSourceProvenance.to(
          attachProvenanceAndGuard.to(
            processSources.onDone(buildExecutionSummary).onEachBatch(sourceLoopBody)
          )
        )
      )
    )
  )
  .add(overviewNote)
  .add(retryLimitationNote)
  .add(adapterArchitectureNote)
  .add(normalizationContractNote)
  .add(sourceRegistryNote)
  .add(safetyInvariantsNote)
  .add(futureTargetArchitectureNote);
