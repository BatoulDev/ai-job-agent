/**
 * Source Intelligence Analyzer — n8n Workflow SDK source
 *
 * IMPORT INSTRUCTIONS
 * ───────────────────
 * Import the companion JSON file via n8n UI → (hamburger menu) → Import
 * from File → source-intelligence-analyzer.json, or via n8n MCP
 * create_workflow_from_code / update_workflow using this source.
 *
 * CREDENTIALS (configure in n8n → Settings → Credentials before running)
 * ──────────────────────────────────────────────────────────────────────
 *   Type: Supabase, Name: "Supabase Service Role" (same credential the
 *   Job Ingestion Pilot Orchestrator and CV Analysis Worker already use —
 *   service-role key, local Supabase project).
 *
 * ERROR WORKFLOW (added 2026-09-24 — manual n8n UI step, not repo-set)
 * ──────────────────────────────────────────────────────────────────────
 *   n8n-workflows/error-handler.ts is the reusable execution-level
 *   failure handler (Error Trigger → normalize → alert message → a
 *   not-yet-wired notification boundary — see its own header for the
 *   full design and why a notification channel isn't connected yet).
 *   Attach this workflow to it via Settings (three-dot menu) → Error
 *   Workflow → "AI Job Agent - Error Handler". This is a one-time manual
 *   step in the n8n UI — confirmed this session that neither the n8n
 *   Workflow SDK nor n8n-mcp's update_workflow can set a workflow-level
 *   setting like this, so it cannot be represented in this repo file or
 *   applied by tooling. Only a genuinely FAILED execution (a crashed
 *   node — bad credential, unreachable Supabase) reaches the handler;
 *   per-source outcomes (429/403/5xx/no-URL/etc.) are deliberately
 *   handled as data by this workflow's own classification/retry logic
 *   and never propagate to a workflow-level failure.
 *
 * WORKFLOW CONFIGURATION NODE (first node after the trigger — edit before running)
 * ──────────────────────────────────────────────────────────────────────────────
 *   mode                  — 'dry_run' (default) or 'write'. Only 'write' reaches
 *                            the Insert Source Intelligence Observation branch;
 *                            any other value (including the default) skips it
 *                            entirely — 0 inserts attempted. The operator must
 *                            explicitly flip this to 'write' for a controlled
 *                            manual test; nothing switches it automatically.
 *   supabaseBaseUrl        — local: http://host.docker.internal:55321. Centralized
 *                            here deliberately — every downstream node reads it via
 *                            $json.supabaseBaseUrl / $('Workflow Configuration')...,
 *                            never a second literal copy. n8n environment variables
 *                            ($env) and Variables ($vars) were both evaluated as
 *                            alternatives and are not usable on this instance —
 *                            $env is blocked (N8N_BLOCK_ENV_ACCESS_IN_NODE), and
 *                            Variables requires a license tier this Community
 *                            install doesn't have (verified via `n8n license:info`
 *                            inside the container, 2026-09-19 — no variables
 *                            entitlement present). Promoting this workflow to a
 *                            new n8n environment means editing this one field by
 *                            hand — see docs/PRODUCTION_READINESS.md's n8n
 *                            promotion checklist.
 *   environment             — 'local' (informational label). Included in Build Run
 *                            Summary only — nothing in this workflow branches on
 *                            it; it is not a safety gate.
 *   maxSourcesPerRun        — bounded cap on rows read from company_sources
 *   rateLimitDelaySeconds   — pause between sources (conservative per-source rate limit)
 *   timeoutSeconds          — timeout for each per-source page fetch
 *   sinceSourceId           — legacy field, default ''. NOT read by Load Candidate
 *                             Sources anymore — the query no longer references it at
 *                             all, so normal operation has zero dependency on this
 *                             value regardless of what it's set to. Kept only as an
 *                             inert placeholder field on Workflow Configuration for a
 *                             possible future manual fallback; safe to delete outright
 *                             in a later cleanup pass. Not removed yet per explicit
 *                             instruction — do not wire it back into the query without
 *                             a fresh, explicit request.
 *
 * SOURCE SELECTION — explicit eligibility model, no cursor (updated 2026-09-24)
 * ───────────────────────────────────────────────────────────────────────────
 * Load Candidate Sources selects company_sources rows where
 * (ats_provider = 'unknown' OR automation_eligibility = 'unknown') AND
 * EITHER (A) never analyzed at all, OR (B) the LATEST source_intelligence
 * observation is a retryable needs_investigation result whose 3-day
 * backoff has elapsed — via a POST to
 * /rest/v1/rpc/get_source_intelligence_candidates — a SQL function
 * (supabase/migrations/20260919090000_create_source_intelligence_candidate_selector.sql,
 * superseded by supabase/migrations/20260924140000_add_source_intelligence_retry_eligibility.sql)
 * that runs the eligibility check as real SQL inside Postgres, never a
 * PostgREST-translated filter (see that first migration's own header for
 * the embedded-anti-join pattern proven broken here — do not revert to
 * it).
 *
 * ANY successful classification (ats_adapter/html/custom_parser) still
 * excludes a source from all future runs, exactly as before — a stable
 * result is never re-analyzed without a specific reason. What changed is
 * ONLY needs_investigation: it is no longer a permanent exclusion. The
 * RPC distinguishes RETRYABLE (a transient fetch outcome — network error,
 * HTTP 403/429/999, or 5xx — see Build Blocked Result's own retryable
 * computation) from STRUCTURAL (404, no URL, or a successfully-fetched-
 * but-genuinely-inconclusive page — see Build No-URL Result and Detect
 * Provider Fingerprint's own needs_investigation branch) via the new
 * source_intelligence.retryable column, set explicitly by the node that
 * produced the result — never inferred later from evidence text. Only
 * RETRYABLE results become eligible again, and only after 3 days —
 * structural results are excluded exactly as permanently as before this
 * change. The response now also carries selection_reason ('never_analyzed'
 * | 'retry_after_backoff') and the previous observation's own
 * ingestion_type/confidence/analyzed_at, purely for dry-run visibility —
 * Bound Candidate Sources threads these straight through unchanged.
 * This is the ONLY selection mechanism — the manual `id=gt.<sinceSourceId>`
 * cursor fragment remains removed from the query entirely.
 *
 * DRY-RUN / CONTROLLED WRITE SCOPE
 * ─────────────────────────────────────────────────────────────
 * This workflow reads company_sources (GET) and a public careers/website
 * URL per source (GET), and — only when mode === 'write' — appends one
 * insert-only row per finalized classification into
 * public.source_intelligence (see
 * supabase/migrations/20260916171255_create_source_intelligence.sql). It
 * never UPDATEs/UPSERTs/DELETEs an existing source_intelligence row,
 * never writes jobs, and never activates a source in the "make it live
 * for job scraping" sense. There is no adapter here and no connection to
 * the Job Ingestion Pilot Orchestrator — this is a separate, standalone
 * workflow.
 *
 * CONTROLLED PROMOTION (write mode only, added 2026-09-24)
 * ───────────────────────────────────────────────────────────
 * After a successful insert, a newly-added branch decides — from the
 * insert response alone, no re-fetch — whether this exact classification
 * is auto-promotable per the approved rule: ingestion_type='ats_adapter'
 * AND confidence='high' AND detected_provider<>'unknown' AND the insert
 * itself actually succeeded. If so, it calls the single new
 * public.promote_source_intelligence_observation(p_source_id) RPC (see
 * supabase/migrations/20260924130000_add_source_intelligence_promotion.sql
 * for the full rule and its reasoning) — this is now the one and only
 * place this workflow ever writes to company_sources, and it only ever
 * updates ats_provider/automation_eligibility, guarded so an already-
 * non-'unknown' value (a human's or another process's decision) is never
 * overwritten. review_status and company_id are never touched by this
 * workflow, in dry_run or write mode alike. Everything that fails the
 * auto-promotion rule (medium/low confidence, unknown provider,
 * needs_investigation, html, custom_parser, a blocked/no-URL result, or a
 * failed insert) is left exactly as before this change: an unresolved,
 * reviewable source_intelligence row only, with company_sources
 * untouched.
 *
 * See the "Controlled write mode" sticky note for known pre-conditions
 * (a credential that must be bound manually) that must be resolved
 * before a real write-mode test.
 *
 * SAFE FETCHING
 * ─────────────
 * Every per-source fetch is a single plain HTTP GET against
 * official_careers_url / official_website_url — the same public URL a
 * browser would load anonymously. No login, no auth bypass, no CAPTCHA
 * bypass, no form submission, no protected endpoint. A blocked, erroring,
 * or non-2xx response is classified needs_investigation once — this
 * workflow never retries a fetch (deliberately, per source: "do not retry
 * aggressively" — unlike the Job Ingestion Pilot Orchestrator's bounded
 * exponential-backoff retry loop, which does not apply here).
 *
 * PROVIDER FINGERPRINT DETECTION
 * ───────────────────────────────
 * "Detect Provider Fingerprint" only ever classifies a known ATS
 * (detected_provider) when one of the 9 documented provider domain/path
 * signals is actually found in the fetched URL or page content — never a
 * guess. Confidence: high when the fetched URL itself is the provider's
 * domain (direct hit); medium when the signal is only referenced inside
 * the page content (e.g. an embedded widget/script/link); low for every
 * heuristic HTML/custom-parser/needs_investigation classification with no
 * provider signal at all.
 *
 * INGESTION_TYPE VALUES — aligned to source_intelligence's own check
 * constraint (ats_adapter, api, html, custom_parser, manual,
 * needs_investigation), NOT the task brief's literal "_candidate" suffix
 * spelling — 'html' / 'custom_parser' here ARE the "html_candidate" /
 * "custom_parser_candidate" concept, spelled to match the table this
 * output is designed to eventually feed.
 */

import {
  workflow,
  node,
  trigger,
  sticky,
  ifElse,
  splitInBatches,
  nextBatch,
  newCredential,
  expr,
} from '@n8n/workflow-sdk';

// ─────────────────────────────────────────────────────────────────────────
// Trigger + configuration
// ─────────────────────────────────────────────────────────────────────────

const startTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Start Source Intelligence Run', position: [-200, 0] },
  output: [{}],
});

// Kept alongside the Manual Trigger deliberately: the operator still needs a
// no-wait way to run a single controlled batch and inspect Build Run Summary
// immediately (exactly how every dry-run/write-mode validation pass in this
// project has been done so far) — the Schedule Trigger alone can't serve
// that role. Both triggers feed the same Workflow Configuration node; each
// fires its own independent execution, so they never conflict with or
// duplicate each other.
//
// TIMEZONE: triggerAtHour is interpreted in the n8n instance's effective
// timezone. As of this writing that instance has no GENERIC_TIMEZONE set
// and no workflow-level settings.timezone override, so it resolves to UTC —
// confirmed via the container's system clock and Node's own
// Intl.DateTimeFormat().resolvedOptions().timeZone. 14 here is UTC, not yet
// Asia/Beirut local time (that would need workflow settings.timezone set to
// "Asia/Beirut", which the available MCP tooling could not set — no
// setWorkflowSettings-equivalent operation was exposed at the time this was
// written).
const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Daily Schedule Trigger',
    position: [-200, 200],
    parameters: {
      rule: {
        interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 14, triggerAtMinute: 0 }],
      },
    },
  },
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
          { id: 'max-sources-field', name: 'maxSourcesPerRun', value: 10, type: 'number' },
          { id: 'rate-limit-field', name: 'rateLimitDelaySeconds', value: 2, type: 'number' },
          { id: 'timeout-field', name: 'timeoutSeconds', value: 10, type: 'number' },
          { id: 'started-at-field', name: 'startedAt', value: expr('{{ $now.toISO() }}'), type: 'string' },
          { id: 'since-source-id-field', name: 'sinceSourceId', value: '', type: 'string' },
        ],
      },
    },
  },
  output: [{ mode: 'dry_run', supabaseBaseUrl: 'http://host.docker.internal:55321', environment: 'local', maxSourcesPerRun: 10, rateLimitDelaySeconds: 2, timeoutSeconds: 10, startedAt: '2026-09-18T00:00:00.000Z', sinceSourceId: '' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Load a bounded page of candidate sources
// ─────────────────────────────────────────────────────────────────────────

const loadCandidateSources = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Load Candidate Sources',
    position: [400, 0],
    parameters: {
      // Calls the get_source_intelligence_candidates(p_limit) SQL function
      // (supabase/migrations/20260919090000_create_source_intelligence_candidate_selector.sql)
      // instead of a raw GET with a PostgREST embedded-resource anti-join.
      // The old pattern — source_intelligence!left(source_id) combined with
      // source_intelligence.source_id=is.null — was confirmed live (direct,
      // read-only reproduction against this project's local database) to
      // NOT exclude company_sources rows that already have a
      // source_intelligence row: PostgREST's embedded-filter semantics for
      // a !left embed only prune the nested embedded array in the JSON
      // response, they never exclude the parent row from the top-level
      // result. Every run therefore reselected the same top-N rows and
      // produced duplicate source_intelligence rows for the same source_id
      // across separate executions. The RPC runs a real SQL NOT EXISTS
      // inside Postgres, which is not subject to that PostgREST filter
      // limitation.
      method: 'POST',
      url: expr("{{ $json.supabaseBaseUrl }}/rest/v1/rpc/get_source_intelligence_candidates"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/json' }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ { p_limit: $json.maxSourcesPerRun } }}'),
      options: { timeout: expr('{{ $json.timeoutSeconds * 1000 }}') },
    },
    credentials: { supabaseApi: newCredential('Supabase Service Role') },
  },
  output: [
    {
      source: { id: 'sr-example', company_name: 'Example Co', official_careers_url: 'https://example.com/careers', official_website_url: 'https://example.com', ats_provider: 'unknown', automation_eligibility: 'unknown', researcher_notes: null },
      selection_reason: 'never_analyzed',
      previous_ingestion_type: null,
      previous_confidence: null,
      previous_analyzed_at: null,
    },
  ],
});

// Reads the RPC's nested `source` composite (the return shape changed
// 2026-09-24 from a flat setof company_sources to source + selection
// context — see get_source_intelligence_candidates()'s own comment) and
// threads selectionReason/previousIngestionType/previousConfidence/
// previousAnalyzedAt straight through every downstream node via the
// existing `...src` spread pattern — this is what gives dry_run real
// visibility into "new vs retry, and why" without any further plumbing.
const boundCandidateSources = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Bound Candidate Sources',
    position: [700, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const cfg = $('Workflow Configuration').first().json;\n" +
        "const runId = $execution.id;\n" +
        "function generateUuidV4() {\n" +
        "  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {\n" +
        "    const r = Math.random() * 16 | 0;\n" +
        "    const v = c === 'x' ? r : (r & 0x3 | 0x8);\n" +
        "    return v.toString(16);\n" +
        "  });\n" +
        "}\n" +
        "const runUuid = generateUuidV4();\n" +
        "const rows = $input.all().map(i => i.json).slice(0, cfg.maxSourcesPerRun);\n" +
        "return rows.map(r => {\n" +
        "  const src = r.source;\n" +
        "  return { json: {\n" +
        "    source_id: src.id,\n" +
        "    company_name: src.company_name,\n" +
        "    official_careers_url: src.official_careers_url || null,\n" +
        "    official_website_url: src.official_website_url || null,\n" +
        "    existing_ats_provider: src.ats_provider || null,\n" +
        "    existing_automation_eligibility: src.automation_eligibility || null,\n" +
        "    researcher_notes: src.researcher_notes || null,\n" +
        "    selectionReason: r.selection_reason,\n" +
        "    previousIngestionType: r.previous_ingestion_type || null,\n" +
        "    previousConfidence: r.previous_confidence || null,\n" +
        "    previousAnalyzedAt: r.previous_analyzed_at || null,\n" +
        "    runId,\n" +
        "    runUuid,\n" +
        "  } };\n" +
        "});",
    },
  },
  output: [{ source_id: 'sr-example', company_name: 'Example Co', official_careers_url: 'https://example.com/careers', official_website_url: 'https://example.com', existing_ats_provider: 'unknown', existing_automation_eligibility: 'unknown', researcher_notes: null, selectionReason: 'never_analyzed', previousIngestionType: null, previousConfidence: null, previousAnalyzedAt: null, runId: 'exec-1', runUuid: '00000000-0000-4000-8000-000000000000' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Per-source loop
// ─────────────────────────────────────────────────────────────────────────

const processSources = splitInBatches({
  version: 3,
  config: { name: 'Process Sources', position: [1000, 0], parameters: { batchSize: 1 } },
});

const chooseFetchTarget = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Choose Fetch Target',
    position: [1300, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const src = $input.first().json;\n" +
        "\n" +
        "function isValidHttpUrl(value) {\n" +
        "  if (typeof value !== 'string') return false;\n" +
        "  const trimmed = value.trim();\n" +
        "  if (!trimmed) return false;\n" +
        "  return /^https?:\\/\\/[^\\s/?#][^\\s]*$/i.test(trimmed);\n" +
        "}\n" +
        "\n" +
        "const careersValid = isValidHttpUrl(src.official_careers_url);\n" +
        "const websiteValid = isValidHttpUrl(src.official_website_url);\n" +
        "\n" +
        "const fetchUrl = careersValid ? src.official_careers_url : (websiteValid ? src.official_website_url : null);\n" +
        "const fetchUrlKind = careersValid ? 'careers' : (websiteValid ? 'website' : null);\n" +
        "\n" +
        "return [{ json: { ...src, fetchUrl, fetchUrlKind } }];",
    },
  },
  output: [{ source_id: 'sr-example', company_name: 'Example Co', fetchUrl: 'https://example.com/careers', fetchUrlKind: 'careers', runId: 'exec-1', existing_ats_provider: 'unknown', existing_automation_eligibility: 'unknown' }],
});

const hasFetchableUrl = ifElse({
  version: 2.3,
  config: {
    name: 'Has Fetchable URL?',
    position: [1600, 0],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.fetchUrl }}'), operator: { type: 'string', operation: 'notEmpty' }, rightValue: '' }],
        combinator: 'and',
      },
    },
  },
});

const buildNoUrlResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build No-URL Result',
    position: [1900, 400],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const src = $input.first().json;\n" +
        "return [{ json: {\n" +
        "  source_id: src.source_id, company_name: src.company_name,\n" +
        "  detected_provider: 'unknown', ingestion_type: 'needs_investigation', confidence: 'low', retryable: false,\n" +
        "  evidence: { matched_signal: null, detection_method: 'no_public_url_available', checked_url: null, http_status: null },\n" +
        "  existing_ats_provider: src.existing_ats_provider, existing_automation_eligibility: src.existing_automation_eligibility,\n" +
        "  runId: src.runId,\n" +
        "} }];",
    },
  },
  output: [{ source_id: 'sr-example', company_name: 'Example Co', detected_provider: 'unknown', ingestion_type: 'needs_investigation', confidence: 'low', retryable: false, evidence: { matched_signal: null, detection_method: 'no_public_url_available', checked_url: null, http_status: null }, existing_ats_provider: 'unknown', existing_automation_eligibility: 'unknown', runId: 'exec-1' }],
});

const fetchSourcePage = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Source Page',
    position: [1900, 0],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: expr('{{ $json.fetchUrl }}'),
      authentication: 'none',
      options: {
        timeout: expr("{{ $('Workflow Configuration').first().json.timeoutSeconds * 1000 }}"),
        redirect: { redirect: { followRedirects: true, maxRedirects: 5 } },
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'text', outputPropertyName: 'body' } },
      },
    },
  },
  output: [{ statusCode: 200, body: '<html><body>Careers</body></html>' }],
});

const evaluateFetchAttempt = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Fetch Attempt',
    position: [2200, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const src = $('Choose Fetch Target').first().json;\n" +
        "const resp = $input.first().json;\n" +
        "const networkError = !!resp.error;\n" +
        "const statusCode = resp.statusCode || null;\n" +
        "const bodyText = typeof resp.body === 'string' ? resp.body : (resp.body ? JSON.stringify(resp.body) : '');\n" +
        "const blocked = networkError || !statusCode || statusCode === 401 || statusCode === 403 || statusCode === 429 || statusCode === 999 || statusCode >= 500;\n" +
        "const success = !blocked && statusCode >= 200 && statusCode < 400;\n" +
        "\n" +
        "const headers = resp.headers || {};\n" +
        "const serverHeader = typeof headers.server === 'string' ? headers.server.slice(0, 60) : null;\n" +
        "const linkHeader = typeof headers.link === 'string' ? headers.link : '';\n" +
        "const setCookieRaw = headers['set-cookie'];\n" +
        "const setCookieHeader = Array.isArray(setCookieRaw) ? setCookieRaw.join(';') : (typeof setCookieRaw === 'string' ? setCookieRaw : '');\n" +
        "\n" +
        "const headerEvidence = {\n" +
        "  server: serverHeader,\n" +
        "  cloudflareDetected: /cloudflare/i.test(serverHeader || '') || /__cf_bm/i.test(setCookieHeader),\n" +
        "  wixDetected: !!headers['x-wix-request-id'],\n" +
        "  wordpressDetected: /wp-json/i.test(linkHeader),\n" +
        "};\n" +
        "\n" +
        "const titleMatch = bodyText.match(/<title[^>]*>([^<]{0,200})<\\/title>/i);\n" +
        "const pageTitle = titleMatch ? titleMatch[1].trim().slice(0, 200) : null;\n" +
        "\n" +
        "const canonicalMatch = bodyText.match(/<link[^>]+rel=[\"']canonical[\"'][^>]+href=[\"']([^\"']{0,300})[\"']/i);\n" +
        "const canonicalUrl = canonicalMatch ? canonicalMatch[1].slice(0, 300) : null;\n" +
        "\n" +
        "return [{ json: {\n" +
        "  ...src,\n" +
        "  httpStatus: statusCode,\n" +
        "  bodyText: success ? bodyText.slice(0, 200000) : '',\n" +
        "  fetchSucceeded: success,\n" +
        "  fetchError: networkError ? String(resp.error) : null,\n" +
        "  headerEvidence,\n" +
        "  pageTitle,\n" +
        "  canonicalUrl,\n" +
        "} }];",
    },
  },
  output: [{ source_id: 'sr-example', company_name: 'Example Co', fetchUrl: 'https://example.com/careers', httpStatus: 200, bodyText: '<html></html>', fetchSucceeded: true, fetchError: null, headerEvidence: { server: 'nginx', cloudflareDetected: false, wixDetected: false, wordpressDetected: false }, pageTitle: 'Careers - Example Co', canonicalUrl: 'https://example.com/careers', runId: 'exec-1', existing_ats_provider: 'unknown', existing_automation_eligibility: 'unknown' }],
});

const fetchSucceeded = ifElse({
  version: 2.3,
  config: {
    name: 'Fetch Succeeded?',
    position: [2500, 0],
    parameters: {
      looseTypeValidation: true,
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.fetchSucceeded }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: true }],
        combinator: 'and',
      },
    },
  },
});

const buildBlockedResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Blocked Result',
    position: [2800, 400],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const src = $input.first().json;\n" +
        "const networkError = !!src.fetchError;\n" +
        "const status = src.httpStatus;\n" +
        "\n" +
        "// Retryable: a network error (no response at all), or an HTTP status\n" +
        "// that typically reflects a TRANSIENT condition — rate limiting (429),\n" +
        "// a bot-block that can lift (403, or 999 as some sites use for it), or\n" +
        "// a server-side failure (5xx). Explicitly NOT retryable: 404 (the page\n" +
        "// genuinely does not exist), 401 (missing credentials this workflow\n" +
        "// will never have), or any other 4xx — none of these change on a bare\n" +
        "// re-fetch of the identical URL; a real fix requires a human/registry\n" +
        "// correction, not a retry. Evidence-grounded against the 42 real\n" +
        "// needs_investigation rows analyzed before this policy was written —\n" +
        "// see supabase/migrations/20260924140000_add_source_intelligence_retry_eligibility.sql.\n" +
        "const retryable = networkError\n" +
        "  || status === 403\n" +
        "  || status === 429\n" +
        "  || status === 999\n" +
        "  || (typeof status === 'number' && status >= 500);\n" +
        "\n" +
        "return [{ json: {\n" +
        "  source_id: src.source_id, company_name: src.company_name,\n" +
        "  detected_provider: 'unknown', ingestion_type: 'needs_investigation', confidence: 'low', retryable,\n" +
        "  evidence: {\n" +
        "    matched_signal: null,\n" +
        "    detection_method: src.fetchError ? 'fetch_network_error' : 'fetch_blocked_or_error_status',\n" +
        "    checked_url: src.fetchUrl, http_status: src.httpStatus,\n" +
        "    page_title: src.pageTitle,\n" +
        "    canonical_url: src.canonicalUrl,\n" +
        "    header_evidence: src.headerEvidence,\n" +
        "  },\n" +
        "  existing_ats_provider: src.existing_ats_provider, existing_automation_eligibility: src.existing_automation_eligibility,\n" +
        "  runId: src.runId,\n" +
        "} }];",
    },
  },
  output: [{ source_id: 'sr-example', company_name: 'Example Co', detected_provider: 'unknown', ingestion_type: 'needs_investigation', confidence: 'low', retryable: true, evidence: { matched_signal: null, detection_method: 'fetch_blocked_or_error_status', checked_url: 'https://example.com/careers', http_status: 403, page_title: null, canonical_url: null, header_evidence: { server: 'cloudflare', cloudflareDetected: true, wixDetected: false, wordpressDetected: false } }, existing_ats_provider: 'unknown', existing_automation_eligibility: 'unknown', runId: 'exec-1' }],
});

const detectProviderFingerprint = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Detect Provider Fingerprint',
    position: [2800, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const src = $input.first().json;\n" +
        "const url = (src.fetchUrl || '').toLowerCase();\n" +
        "const body = src.bodyText || '';\n" +
        "const haystack = (url + '\\n' + body).toLowerCase();\n" +
        "\n" +
        "const PROVIDERS = [\n" +
        "  { id: 'greenhouse', signals: ['boards-api.greenhouse.io', 'job-boards.greenhouse.io', 'boards.greenhouse.io'] },\n" +
        "  { id: 'lever', signals: ['api.lever.co', 'jobs.lever.co'] },\n" +
        "  { id: 'workable', signals: ['apply.workable.com'] },\n" +
        "  { id: 'oracle', signals: ['oraclecloud.com', 'hcmui/candidateexperience'] },\n" +
        "  { id: 'sap', signals: ['successfactors.com', 'sapsf.eu'] },\n" +
        "  { id: 'workday', signals: ['myworkdayjobs.com'] },\n" +
        "  { id: 'taleo', signals: ['taleo.net'] },\n" +
        "  { id: 'smartrecruiters', signals: ['jobs.smartrecruiters.com'] },\n" +
        "  { id: 'icims', signals: ['icims.com'] },\n" +
        "];\n" +
        "\n" +
        "let match = null;\n" +
        "for (const p of PROVIDERS) {\n" +
        "  for (const sig of p.signals) {\n" +
        "    if (haystack.includes(sig)) { match = { provider: p.id, signal: sig }; break; }\n" +
        "  }\n" +
        "  if (match) break;\n" +
        "}\n" +
        "\n" +
        "const OFF_SCOPE_HOSTS = ['linkedin.com'];\n" +
        "const JOB_HUB_KEYWORDS = ['jobs', 'job', 'careers', 'career', 'vacancies', 'vacancy', 'opportunities'];\n" +
        "const JOB_SEARCH_QUERY_HINTS = ['page=', 'q=', 'options=', 'location=', 'search', 'filter', 'category=', 'keyword'];\n" +
        "const JOB_ANCHOR_TEXT_PATTERN = /(job|career|apply|vacanc|recruit|hiring|position|opportunit)/i;\n" +
        "\n" +
        "function hostOf(href) {\n" +
        "  const abs = href.match(/^https?:\\/\\/([^\\/?#]+)/i);\n" +
        "  if (abs) return abs[1].toLowerCase().replace(/^www\\./, '');\n" +
        "  const proto = href.match(/^\\/\\/([^\\/?#]+)/);\n" +
        "  if (proto) return proto[1].toLowerCase().replace(/^www\\./, '');\n" +
        "  return null;\n" +
        "}\n" +
        "\n" +
        "const pageHost = hostOf(src.fetchUrl || '') || '';\n" +
        "const rawAnchors = body.match(/<a\\s+[^>]*href=[\"']([^\"']+)[\"'][^>]*>([\\s\\S]*?)<\\/a>/gi) || [];\n" +
        "const anchorPattern = /<a\\s+[^>]*href=[\"']([^\"']+)[\"'][^>]*>([\\s\\S]*?)<\\/a>/i;\n" +
        "\n" +
        "const seenHrefs = new Set();\n" +
        "const jobDetailLinks = [];\n" +
        "let jobDetailLinkTotal = 0;\n" +
        "const offScopeHosts = new Set();\n" +
        "const externalDomains = new Set();\n" +
        "let jobSearchExample = null;\n" +
        "\n" +
        "for (const raw of rawAnchors.slice(0, 500)) {\n" +
        "  const m = raw.match(anchorPattern);\n" +
        "  if (!m) continue;\n" +
        "  const href = m[1].trim();\n" +
        "  const text = m[2].replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 60);\n" +
        "  if (!href || href.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(href)) continue;\n" +
        "  if (seenHrefs.has(href)) continue;\n" +
        "\n" +
        "  const looksJobRelevant = JOB_ANCHOR_TEXT_PATTERN.test(href) || JOB_ANCHOR_TEXT_PATTERN.test(text);\n" +
        "  if (!looksJobRelevant) continue;\n" +
        "  seenHrefs.add(href);\n" +
        "\n" +
        "  const host = hostOf(href);\n" +
        "  const isExternal = !!host && host !== pageHost;\n" +
        "\n" +
        "  if (isExternal && OFF_SCOPE_HOSTS.some(h => host.includes(h))) {\n" +
        "    offScopeHosts.add(host);\n" +
        "    continue;\n" +
        "  }\n" +
        "  if (isExternal) {\n" +
        "    externalDomains.add(host);\n" +
        "    continue;\n" +
        "  }\n" +
        "\n" +
        "  const parts = href.split('?');\n" +
        "  const pathPart = parts[0];\n" +
        "  const queryPart = parts[1];\n" +
        "  const segments = pathPart.split('/').filter(Boolean);\n" +
        "  const lastSegment = (segments[segments.length - 1] || '').toLowerCase();\n" +
        "  const isHubOnlyPath = JOB_HUB_KEYWORDS.includes(lastSegment);\n" +
        "  const hasSearchQuery = !!queryPart && JOB_SEARCH_QUERY_HINTS.some(hint => queryPart.toLowerCase().includes(hint));\n" +
        "  const pathHasHubKeyword = segments.some(seg => JOB_HUB_KEYWORDS.includes(seg.toLowerCase()));\n" +
        "  const parentSegment = segments.length >= 2 ? segments[segments.length - 2].toLowerCase() : '';\n" +
        "  const parentIsHubKeyword = JOB_HUB_KEYWORDS.includes(parentSegment);\n" +
        "  const slugTokens = lastSegment.split(/[-_]+/).filter(Boolean);\n" +
        "  const looksLikeSpecificSlug = slugTokens.length >= 4 || /\\d/.test(lastSegment);\n" +
        "  const isPlausibleJobDetail = !isHubOnlyPath && (parentIsHubKeyword || looksLikeSpecificSlug);\n" +
        "\n" +
        "  if (isPlausibleJobDetail) {\n" +
        "    jobDetailLinkTotal += 1;\n" +
        "    if (jobDetailLinks.length < 5) jobDetailLinks.push({ href: href.slice(0, 150), text });\n" +
        "  }\n" +
        "  if (pathHasHubKeyword && hasSearchQuery && !jobSearchExample) {\n" +
        "    jobSearchExample = href.slice(0, 200);\n" +
        "  }\n" +
        "}\n" +
        "\n" +
        "const ldBlocks = body.match(/<script[^>]+type=[\"']application\\/ld\\+json[\"'][^>]*>([\\s\\S]*?)<\\/script>/gi) || [];\n" +
        "const ldTypeSet = new Set();\n" +
        "for (const block of ldBlocks) {\n" +
        "  const types = block.match(/\"@type\"\\s*:\\s*\"([^\"]+)\"/g) || [];\n" +
        "  for (const t of types) {\n" +
        "    const mm = t.match(/\"@type\"\\s*:\\s*\"([^\"]+)\"/);\n" +
        "    if (mm && mm[1]) ldTypeSet.add(mm[1].slice(0, 40));\n" +
        "    if (ldTypeSet.size >= 8) break;\n" +
        "  }\n" +
        "  if (ldTypeSet.size >= 8) break;\n" +
        "}\n" +
        "const jsonLdTypes = Array.from(ldTypeSet);\n" +
        "const hasJobPostingSchema = jsonLdTypes.some(t => t.toLowerCase() === 'jobposting') || haystack.includes('schema.org/jobposting');\n" +
        "\n" +
        "const pageContext = {\n" +
        "  page_title: src.pageTitle || null,\n" +
        "  canonical_url: src.canonicalUrl || null,\n" +
        "  header_evidence: src.headerEvidence || null,\n" +
        "  json_ld_types: jsonLdTypes,\n" +
        "  distinct_job_detail_links: jobDetailLinks,\n" +
        "  job_detail_link_total: jobDetailLinkTotal,\n" +
        "  job_search_url_example: jobSearchExample,\n" +
        "  off_scope_platforms: Array.from(offScopeHosts).slice(0, 3),\n" +
        "  external_domains_referenced: Array.from(externalDomains).slice(0, 5),\n" +
        "};\n" +
        "\n" +
        "let result;\n" +
        "if (match) {\n" +
        "  const directHit = url.includes(match.signal);\n" +
        "  result = {\n" +
        "    detected_provider: match.provider, ingestion_type: 'ats_adapter', confidence: directHit ? 'high' : 'medium', retryable: null,\n" +
        "    evidence: {\n" +
        "      matched_signal: match.signal,\n" +
        "      detection_method: directHit ? 'fetched_url_is_provider_domain' : 'provider_domain_referenced_in_page_content',\n" +
        "      checked_url: src.fetchUrl, http_status: src.httpStatus,\n" +
        "      ...pageContext,\n" +
        "    },\n" +
        "  };\n" +
        "} else {\n" +
        "  const scriptTagCount = (body.match(/<script/gi) || []).length;\n" +
        "  const visibleTextLength = body.replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim().length;\n" +
        "  const looksLikeSpaShell = scriptTagCount >= 5 && visibleTextLength < 500;\n" +
        "  const hasWeakKeywordSignal = /(job opening|open position|apply now|current openings|career opportunit|view job|job listing)/i.test(body);\n" +
        "  const hasDistinctJobDetailLinks = jobDetailLinks.length >= 1;\n" +
        "  const hasJobSearchStructure = !!jobSearchExample;\n" +
        "\n" +
        "  if (looksLikeSpaShell) {\n" +
        "    result = {\n" +
        "      detected_provider: 'unknown', ingestion_type: 'custom_parser', confidence: 'low', retryable: null,\n" +
        "      evidence: { matched_signal: null, detection_method: 'javascript_rendered_shell_detected', checked_url: src.fetchUrl, http_status: src.httpStatus, ...pageContext },\n" +
        "    };\n" +
        "  } else if (hasJobPostingSchema || hasDistinctJobDetailLinks || hasJobSearchStructure) {\n" +
        "    const signal = hasJobPostingSchema ? 'schema.org/JobPosting' : (hasJobSearchStructure ? jobSearchExample : 'distinct_job_detail_links');\n" +
        "    const method = hasJobPostingSchema ? 'jobposting_schema_detected' : (hasJobSearchStructure ? 'job_search_url_structure_detected' : 'distinct_job_detail_links_detected');\n" +
        "    result = {\n" +
        "      detected_provider: 'unknown', ingestion_type: 'html', confidence: 'low', retryable: null,\n" +
        "      evidence: { matched_signal: signal, detection_method: method, checked_url: src.fetchUrl, http_status: src.httpStatus, ...pageContext },\n" +
        "    };\n" +
        "  } else {\n" +
        "    // Fetched fine (status already succeeded upstream) but genuinely\n" +
        "    // no recognizable signal at all — a real, stable finding. Re-\n" +
        "    // fetching the identical page will not produce new information,\n" +
        "    // so this is structural (retryable: false), never auto-retried —\n" +
        "    // matches 32/42 of the real historical needs_investigation rows\n" +
        "    // analyzed before this policy was written (29 no-signal + 3\n" +
        "    // off-scope-destination-only, see the retry-eligibility migration).\n" +
        "    result = {\n" +
        "      detected_provider: 'unknown', ingestion_type: 'needs_investigation', confidence: 'low', retryable: false,\n" +
        "      evidence: {\n" +
        "        matched_signal: null,\n" +
        "        detection_method: offScopeHosts.size > 0 ? 'off_scope_job_destination_only' : 'no_provider_fingerprint_or_job_content_detected',\n" +
        "        checked_url: src.fetchUrl, http_status: src.httpStatus,\n" +
        "        weak_keyword_signal: hasWeakKeywordSignal,\n" +
        "        ...pageContext,\n" +
        "      },\n" +
        "    };\n" +
        "  }\n" +
        "}\n" +
        "\n" +
        "return [{ json: {\n" +
        "  source_id: src.source_id, company_name: src.company_name,\n" +
        "  ...result,\n" +
        "  existing_ats_provider: src.existing_ats_provider, existing_automation_eligibility: src.existing_automation_eligibility,\n" +
        "  runId: src.runId,\n" +
        "} }];",
    },
  },
  output: [{ source_id: 'sr-example', company_name: 'Example Co', detected_provider: 'greenhouse', ingestion_type: 'ats_adapter', confidence: 'high', retryable: null, evidence: { matched_signal: 'boards-api.greenhouse.io', detection_method: 'fetched_url_is_provider_domain', checked_url: 'https://boards-api.greenhouse.io/v1/boards/example/jobs', http_status: 200 }, existing_ats_provider: 'unknown', existing_automation_eligibility: 'unknown', runId: 'exec-1' }],
});

const finalizeClassificationResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Finalize Classification Result',
    position: [3100, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const r = $input.first().json;\n" +
        "// Evaluated purely from the classification itself — mirrors Is Auto-\n" +
        "// Promotable?'s own rule exactly, but independent of insertPerformed\n" +
        "// (which does not exist yet at this point, and never will in dry_run)\n" +
        "// — this is what gives dry_run visibility into \"would this be auto-\n" +
        "// promoted\" without ever attempting a real insert or promotion.\n" +
        "const wouldBeAutoPromotable = r.ingestion_type === 'ats_adapter' && r.confidence === 'high' && r.detected_provider !== 'unknown';\n" +
        "return [{ json: {\n" +
        "  ...r,\n" +
        "  analyzedAt: new Date().toISOString(),\n" +
        "  wouldBeAutoPromotable,\n" +
        "  insertAttempted: false, insertPerformed: false, insertError: null,\n" +
        "  promotionAttempted: false, promotionApplied: false, promotionReason: null,\n" +
        "} }];",
    },
  },
  output: [{ source_id: 'sr-example', company_name: 'Example Co', detected_provider: 'unknown', ingestion_type: 'needs_investigation', confidence: 'low', retryable: false, evidence: {}, existing_ats_provider: 'unknown', existing_automation_eligibility: 'unknown', runId: 'exec-1', analyzedAt: '2026-09-18T00:00:05.000Z', wouldBeAutoPromotable: false, insertAttempted: false, insertPerformed: false, insertError: null, promotionAttempted: false, promotionApplied: false, promotionReason: null }],
});

// ─────────────────────────────────────────────────────────────────────────
// Controlled append-only write path (mode === 'write' only)
// ─────────────────────────────────────────────────────────────────────────

const isWriteMode = ifElse({
  version: 2.3,
  config: {
    name: 'Is Write Mode?',
    position: [3300, 150],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr("{{ $('Workflow Configuration').first().json.mode }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'write' }],
        combinator: 'and',
      },
    },
  },
});

const insertSourceIntelligenceObservation = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Insert Source Intelligence Observation',
    position: [3600, 0],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/source_intelligence"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Prefer', value: 'return=minimal' }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        "{{ { source_id: $json.source_id, run_id: $('Bound Candidate Sources').first().json.runUuid, detected_provider: $json.detected_provider, ingestion_type: $json.ingestion_type, confidence: $json.confidence, retryable: $json.retryable, evidence: $json.evidence, analyzed_at: $json.analyzedAt } }}"
      ),
      options: {
        timeout: expr("{{ $('Workflow Configuration').first().json.timeoutSeconds * 1000 }}"),
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
      },
    },
    credentials: { supabaseApi: newCredential('Supabase Service Role') },
  },
  output: [{ statusCode: 201, body: {} }],
});

const evaluateInsertAttempt = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Insert Attempt',
    position: [3900, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const src = $('Finalize Classification Result').first().json;\n" +
        "const resp = $input.first().json;\n" +
        "const networkError = !!resp.error;\n" +
        "const statusCode = resp.statusCode || null;\n" +
        "const insertPerformed = !networkError && statusCode >= 200 && statusCode < 300;\n" +
        "const responseBody = resp.body;\n" +
        "const errorMessage = insertPerformed\n" +
        "  ? null\n" +
        "  : (networkError\n" +
        "      ? String(resp.error)\n" +
        "      : (responseBody && typeof responseBody === 'object' && responseBody.message\n" +
        "          ? String(responseBody.message).slice(0, 300)\n" +
        "          : `insert_failed_status_${statusCode}`));\n" +
        "\n" +
        "return [{ json: {\n" +
        "  ...src,\n" +
        "  insertAttempted: true,\n" +
        "  insertPerformed,\n" +
        "  insertError: errorMessage,\n" +
        "} }];",
    },
  },
  output: [{ source_id: 'sr-example', company_name: 'Example Co', detected_provider: 'unknown', ingestion_type: 'needs_investigation', confidence: 'low', evidence: {}, existing_ats_provider: 'unknown', existing_automation_eligibility: 'unknown', runId: 'exec-1', analyzedAt: '2026-09-18T00:00:05.000Z', insertAttempted: true, insertPerformed: true, insertError: null }],
});

// Cheap, pure client-side pre-check — mirrors the RPC's own eligibility
// condition exactly so an ineligible classification (the large majority —
// see this file's own header) never even makes the round trip. This is an
// efficiency gate ONLY, never the safety boundary: promote_source_
// intelligence_observation() re-validates every one of these conditions
// itself from the stored source_intelligence row, not from whatever this
// node decided, so a bug here can never cause an unsafe promotion — at
// worst it would skip a promotion the RPC would have allowed, never the
// reverse.
const isAutoPromotable = ifElse({
  version: 2.3,
  config: {
    name: 'Is Auto-Promotable?',
    position: [4200, -150],
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          { leftValue: expr('{{ $json.insertPerformed }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: true },
          { leftValue: expr('{{ $json.ingestion_type }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'ats_adapter' },
          { leftValue: expr('{{ $json.confidence }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'high' },
          { leftValue: expr('{{ $json.detected_provider }}'), operator: { type: 'string', operation: 'notEquals' }, rightValue: 'unknown' },
        ],
        combinator: 'and',
      },
    },
  },
});

// Calls the single controlled promotion RPC (supabase/migrations/
// 20260924130000_add_source_intelligence_promotion.sql) — never a direct
// PATCH/UPDATE against company_sources from this or any other node. The
// RPC itself re-validates eligibility, resolves ats_provider and (only
// for a provider with a real Job Ingestion adapter today) automation_
// eligibility, guards against overwriting an already-non-'unknown' value,
// never touches review_status/company_id, and is idempotent — safe to
// call more than once for the same source_id.
const promoteSource = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Promote Source',
    position: [4500, -300],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.supabaseBaseUrl }}/rest/v1/rpc/promote_source_intelligence_observation"),
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'supabaseApi',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/json' }] },
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ { p_source_id: $json.source_id } }}'),
      options: {
        timeout: expr("{{ $('Workflow Configuration').first().json.timeoutSeconds * 1000 }}"),
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
      },
    },
    credentials: { supabaseApi: newCredential('Supabase Service Role') },
  },
  output: [{ statusCode: 200, body: [{ promoted: true, reason: 'promoted', source_id: 'sr-example', ats_provider_applied: true, automation_eligibility_applied: true, resulting_ats_provider: 'greenhouse', resulting_automation_eligibility: 'suitable_public_ats' }] }],
});

const evaluatePromotionAttempt = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Evaluate Promotion Attempt',
    position: [4800, -300],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const src = $('Evaluate Insert Attempt').first().json;\n" +
        "const resp = $input.first().json;\n" +
        "const networkError = !!resp.error;\n" +
        "const statusCode = resp.statusCode || null;\n" +
        "const httpOk = !networkError && statusCode >= 200 && statusCode < 300;\n" +
        "const body = resp.body;\n" +
        "const row = httpOk && Array.isArray(body) ? body[0] : null;\n" +
        "\n" +
        "const promotionApplied = httpOk && !!row && row.promoted === true;\n" +
        "const promotionReason = httpOk\n" +
        "  ? (row ? row.reason : 'promotion_rpc_returned_no_row')\n" +
        "  : (networkError\n" +
        "      ? String(resp.error).slice(0, 300)\n" +
        "      : (body && typeof body === 'object' && body.message ? String(body.message).slice(0, 300) : `promotion_failed_status_${statusCode}`));\n" +
        "\n" +
        "return [{ json: {\n" +
        "  ...src,\n" +
        "  promotionAttempted: true,\n" +
        "  promotionApplied,\n" +
        "  promotionReason,\n" +
        "} }];",
    },
  },
  output: [{ source_id: 'sr-example', company_name: 'Example Co', detected_provider: 'greenhouse', ingestion_type: 'ats_adapter', confidence: 'high', evidence: {}, existing_ats_provider: 'unknown', existing_automation_eligibility: 'unknown', runId: 'exec-1', insertAttempted: true, insertPerformed: true, insertError: null, promotionAttempted: true, promotionApplied: true, promotionReason: 'promoted' }],
});

const rateLimitDelay = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Rate Limit Delay',
    position: [3400, 0],
    parameters: {
      resume: 'timeInterval',
      amount: expr("{{ $('Workflow Configuration').first().json.rateLimitDelaySeconds }}"),
      unit: 'seconds',
    },
  },
  output: [{}],
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
        "const results = $input.all().map(i => i.json);\n" +
        "const startedAtMs = new Date(cfg.startedAt).getTime();\n" +
        "const countBy = (key, val) => results.filter(r => r[key] === val).length;\n" +
        "\n" +
        "const detectedProviders = {};\n" +
        "for (const r of results) {\n" +
        "  if (r.detected_provider && r.detected_provider !== 'unknown') {\n" +
        "    detectedProviders[r.detected_provider] = (detectedProviders[r.detected_provider] || 0) + 1;\n" +
        "  }\n" +
        "}\n" +
        "\n" +
        "const insertsAttempted = results.filter(r => r.insertAttempted === true).length;\n" +
        "const insertsPerformed = results.filter(r => r.insertPerformed === true).length;\n" +
        "const insertFailures = results.filter(r => r.insertAttempted === true && r.insertPerformed !== true).length;\n" +
        "const promotionsAttempted = results.filter(r => r.promotionAttempted === true).length;\n" +
        "const promotionsApplied = results.filter(r => r.promotionApplied === true).length;\n" +
        "const newSources = results.filter(r => r.selectionReason === 'never_analyzed').length;\n" +
        "const retriedSources = results.filter(r => r.selectionReason === 'retry_after_backoff').length;\n" +
        "const retryableNeedsInvestigation = results.filter(r => r.ingestion_type === 'needs_investigation' && r.retryable === true).length;\n" +
        "const structuralNeedsInvestigation = results.filter(r => r.ingestion_type === 'needs_investigation' && r.retryable !== true).length;\n" +
        "const wouldBeAutoPromotedDryRun = results.filter(r => r.wouldBeAutoPromotable === true).length;\n" +
        "\n" +
        "return [{ json: {\n" +
        "  mode: cfg.mode,\n" +
        "  environment: cfg.environment,\n" +
        "  runId: results.length ? results[0].runId : $execution.id,\n" +
        "  maxSourcesPerRun: cfg.maxSourcesPerRun,\n" +
        "  sourcesAnalyzed: results.length,\n" +
        "  newSources,\n" +
        "  retriedSources,\n" +
        "  detectedProviders,\n" +
        "  atsAdapterCandidates: countBy('ingestion_type', 'ats_adapter'),\n" +
        "  htmlCandidates: countBy('ingestion_type', 'html'),\n" +
        "  customCandidates: countBy('ingestion_type', 'custom_parser'),\n" +
        "  needsInvestigation: countBy('ingestion_type', 'needs_investigation'),\n" +
        "  retryableNeedsInvestigation,\n" +
        "  structuralNeedsInvestigation,\n" +
        "  stillUnknown: countBy('detected_provider', 'unknown'),\n" +
        "  writeMode: cfg.mode === 'write',\n" +
        "  wouldBeAutoPromotedDryRun,\n" +
        "  insertsAttempted,\n" +
        "  insertsPerformed,\n" +
        "  insertFailures,\n" +
        "  promotionsAttempted,\n" +
        "  promotionsApplied,\n" +
        "  totalDurationMs: Date.now() - startedAtMs,\n" +
        "  results,\n" +
        "  finishedAt: new Date().toISOString(),\n" +
        "} }];",
    },
  },
  output: [{ mode: 'dry_run', environment: 'local', runId: 'exec-1', maxSourcesPerRun: 10, sourcesAnalyzed: 10, newSources: 7, retriedSources: 3, detectedProviders: { greenhouse: 2 }, atsAdapterCandidates: 2, htmlCandidates: 3, customCandidates: 1, needsInvestigation: 4, retryableNeedsInvestigation: 1, structuralNeedsInvestigation: 3, stillUnknown: 8, writeMode: false, wouldBeAutoPromotedDryRun: 2, insertsAttempted: 0, insertsPerformed: 0, insertFailures: 0, promotionsAttempted: 0, promotionsApplied: 0, totalDurationMs: 12000, results: [], finishedAt: '2026-09-18T00:00:12.000Z' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Sticky notes
// ─────────────────────────────────────────────────────────────────────────

const overviewNote = sticky(
  '### Source Intelligence Analyzer\n' +
    'Selects company_sources rows (ats_provider=unknown OR automation_eligibility=unknown) that are EITHER never ' +
    'analyzed OR whose latest observation was a retryable transient failure past its 3-day backoff (state-driven ' +
    'via the get_source_intelligence_candidates SQL RPC, not a manual cursor — see the Retry Policy note), GETs ' +
    'each source\'s public careers/website URL once, and classifies it. In dry_run mode (default) nothing is ' +
    'written anywhere. In write mode, each classification is appended to source_intelligence (now allowing ' +
    'multiple observations per source over time — true history), and ONLY a high-confidence known-ATS result ' +
    '(ingestion_type=ats_adapter, confidence=high) is then promoted through a single guarded RPC into ' +
    'company_sources.ats_provider/automation_eligibility — never review_status, never company_id, never a ' +
    'direct UPDATE from this workflow. Every other result (medium/low confidence, unknown, structural ' +
    'needs_investigation, html, custom_parser, blocked/no-URL) stays an unresolved observation only. No source ' +
    'is ever activated for job scraping here. Not connected to the Job Ingestion Pilot Orchestrator — a fully ' +
    'separate workflow.',
  [startTrigger, workflowConfiguration],
  { color: 6 }
);

const safetyInvariantsNote = node({
  type: 'n8n-nodes-base.stickyNote',
  version: 1,
  config: {
    name: 'Sticky Note - Safety Invariants',
    position: [1600, -420],
    parameters: {
      content:
        '### Safety invariants — keep these when extending\n' +
        'GET-only, no auth/CAPTCHA/form bypass, no retry on a blocked/failed fetch (classify needs_investigation ' +
        'once and move on), maxSourcesPerRun bound, rateLimitDelaySeconds pacing between sources. These are load-' +
        'bearing, not pilot-only scaffolding — preserve all of them before any future write-mode branch is added.',
      height: 200,
      width: 480,
      color: 3,
    },
  },
  output: [{}],
});

const confidenceRulesNote = node({
  type: 'n8n-nodes-base.stickyNote',
  version: 1,
  config: {
    name: 'Sticky Note - Confidence Rules',
    position: [2800, -420],
    parameters: {
      content:
        '### Confidence rules\n' +
        'HIGH — the fetched URL itself is a known provider domain (direct hit). ' +
        'MEDIUM — a provider signal is referenced inside the fetched page, but the page isn\'t hosted on that ' +
        'domain. LOW — every heuristic classification (html / custom_parser / needs_investigation) with no ' +
        'provider fingerprint at all. Never guessed — a provider is only named when a signal was actually found.',
      height: 200,
      width: 480,
      color: 3,
    },
  },
  output: [{}],
});

const retryPolicyNote = node({
  type: 'n8n-nodes-base.stickyNote',
  version: 1,
  config: {
    name: 'Sticky Note - Retry Policy',
    position: [400, -420],
    parameters: {
      content:
        '### Retry / re-analysis policy (added 2026-09-24)\n' +
        'RETRYABLE (source_intelligence.retryable=true, set by Build Blocked Result) — a network error, or HTTP ' +
        '403/429/999/5xx: a transient condition that may have cleared. Becomes an eligible candidate again once ' +
        'analyzed_at is more than 3 days old. STRUCTURAL (retryable=false, set by Build No-URL Result and Detect ' +
        'Provider Fingerprint\'s own inconclusive branch) — no URL, HTTP 404/401, or a page that fetched fine but ' +
        'matched no signal at all: re-fetching the identical page will not change the answer, so these are never ' +
        'auto-retried. A successful classification (ats_adapter/html/custom_parser) is likewise never re-selected ' +
        '— retryable stays null, not applicable. Fixed 3-day backoff, not per-status or exponential — this ' +
        'project runs at most once/day, so anything shorter is meaningless and same-day retries risk re-hitting ' +
        'the exact outage that caused the failure.',
      height: 240,
      width: 620,
      color: 4,
    },
  },
  output: [{}],
});

const futureWriteModeNote = node({
  type: 'n8n-nodes-base.stickyNote',
  version: 1,
  config: {
    name: 'Sticky Note - Future Write Mode',
    position: [3400, -750],
    parameters: {
      content:
        '### Controlled write mode + promotion (gated, off by default)\n' +
        'When Workflow Configuration.mode === \'write\', each finalized classification is appended as a new row ' +
        'in public.source_intelligence (supabase/migrations/20260916171255_create_source_intelligence.sql) — ' +
        'insert-only, never UPDATE/UPSERT/DELETE on that table. Then, ONLY if the insert succeeded AND the ' +
        'result is ingestion_type=ats_adapter + confidence=high + a recognized provider, Promote Source calls ' +
        'public.promote_source_intelligence_observation(p_source_id) (supabase/migrations/' +
        '20260924130000_add_source_intelligence_promotion.sql) — the ONE place this workflow ever writes to ' +
        'company_sources, guarded per-column so an already-non-unknown value is never overwritten, and never ' +
        'touching review_status or company_id. Default mode stays \'dry_run\', where this entire branch — insert ' +
        'and promotion alike — is skipped (0 inserts, 0 promotions attempted). Known pre-condition for a real ' +
        'write-mode test: the Insert/Promote nodes\' Supabase credential must be bound manually in the n8n UI ' +
        '(the MCP cannot auto-assign a predefinedCredentialType credential of type supabaseApi).',
      height: 300,
      width: 620,
      color: 5,
    },
  },
  output: [{}],
});

// ─────────────────────────────────────────────────────────────────────────
// Wiring
// ─────────────────────────────────────────────────────────────────────────

const afterWriteDecision = rateLimitDelay.to(nextBatch(processSources));

const promotionBranch = isAutoPromotable
  .onFalse(afterWriteDecision)
  .onTrue(promoteSource.to(evaluatePromotionAttempt.to(afterWriteDecision)));

const writeModeBranch = isWriteMode
  .onFalse(afterWriteDecision)
  .onTrue(insertSourceIntelligenceObservation.to(evaluateInsertAttempt.to(promotionBranch)));

const finalizeThenNextBatch = finalizeClassificationResult.to(writeModeBranch);

const sourceLoopBody = hasFetchableUrl
  .onFalse(buildNoUrlResult.to(finalizeThenNextBatch))
  .onTrue(
    fetchSourcePage.to(
      evaluateFetchAttempt.to(
        fetchSucceeded
          .onFalse(buildBlockedResult.to(finalizeThenNextBatch))
          .onTrue(detectProviderFingerprint.to(finalizeThenNextBatch))
      )
    )
  );

const mainFlow = workflowConfiguration.to(
  loadCandidateSources.to(
    boundCandidateSources.to(
      processSources.onDone(buildRunSummary).onEachBatch(chooseFetchTarget.to(sourceLoopBody))
    )
  )
);

export default workflow('source-intelligence-analyzer', 'AI Job Agent - Source Intelligence Analyzer')
  .add(startTrigger)
  .to(mainFlow)
  .add(scheduleTrigger)
  .to(mainFlow)
  .add(overviewNote)
  .add(safetyInvariantsNote)
  .add(confidenceRulesNote)
  .add(retryPolicyNote)
  .add(futureWriteModeNote);
