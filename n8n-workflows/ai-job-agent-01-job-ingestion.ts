import { workflow, node, trigger, sticky, splitInBatches, nextBatch, switchCase, merge, newCredential, expr } from '@n8n/workflow-sdk';

const startTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Start Job Ingestion Run' },
});

// Production daily cadence (added once the LinkedIn enrichment branch's
// production-readiness audit closed out — see this workflow's own overview
// sticky note: "stays inactive until a human reviews a run and decides on a
// schedule"). Kept alongside the Manual Trigger deliberately, exactly the
// same reasoning already used for Source Intelligence Analyzer's own
// Schedule Trigger: an operator still needs a no-wait way to run one
// controlled batch for testing/admin use. Both triggers feed the same
// Workflow Configuration node and fire independent executions — they never
// conflict with or duplicate each other.
//
// TIMEZONE (confirmed, same gap already documented in
// source-intelligence-analyzer.ts's own Schedule Trigger): the Schedule
// Trigger node's own parameters (ScheduleTriggerV13Params) have no
// timezone field at all — triggerAtHour/triggerAtMinute are always
// interpreted in the WORKFLOW's own settings.timezone (falling back to the
// n8n instance's GENERIC_TIMEZONE, then UTC, if unset). Neither the n8n
// Workflow SDK nor n8n-mcp's update_workflow exposes a
// setWorkflowSettings-equivalent operation for settings.timezone — the
// exact same confirmed tool limitation as errorWorkflow attachment, which
// also had to be set once, by hand, in the n8n UI. triggerAtHour:9/
// triggerAtMinute:0 below is only genuinely "09:00 Asia/Beirut" once a human sets
// this workflow's own Settings → Timezone → Asia/Beirut in the n8n UI —
// using the real IANA identifier there (not a fixed UTC offset) is what
// makes Lebanon's DST transitions resolve correctly automatically; a
// hardcoded offset would silently drift by an hour across DST boundaries.
// Until that manual step is done, this instance has no GENERIC_TIMEZONE
// set either, so 9/0 would otherwise resolve to 09:00 UTC, not Beirut time.
const dailyBeirutTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Daily 09:00 Beirut Trigger',
    parameters: {
      rule: {
        interval: [{ field: 'days', daysInterval: 1, triggerAtHour: 9, triggerAtMinute: 0 }],
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
    parameters: {
      mode: 'raw',
      jsonOutput: {
        appBaseUrl: 'http://host.docker.internal:3000',
        // 2026-10-02 fix: this was 5 — far below any real ATS/multi-company
        // batch size, which falsely truncated every paid-provider run (see
        // src/lib/ingestion/ingestSourceBatch.ts's clampToProviderCeiling
        // comment). 50 is a generous requested-cap default for branches with
        // no source-specific cap of their own (ATS, free multi-company
        // feeds, career pages) — safe because the server always clamps the
        // requested value down to providerConfig.ts's own maxJobsPerRun
        // regardless of what this sends. The Apify branch no longer reads
        // this field at all — each seed in Apify Multi-Company Source Seeds
        // below carries its own max_jobs_per_run instead.
        maxJobsPerSource: 50,
        rateLimitDelaySeconds: 2,
        // 2026-10-02: flipped to false for the next manual run — the cap
        // fix above is validated (targeted + full test suites, build, type
        // check, lint all green; local DB counts unchanged). Still manual
        // trigger only, active:false, no schedule — see this workflow's own
        // overview sticky note.
        dryRun: false,
      },
    },
  },
  output: [{ appBaseUrl: 'http://host.docker.internal:3000', maxJobsPerSource: 50, rateLimitDelaySeconds: 2, dryRun: false }],
});

const listIngestionSources = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'List Ingestion Sources',
    notes:
      'Discovers verified, automatable company_sources rows dynamically (Phase 12), plus enabled multi-company feed ' +
      'providers and career-page extraction candidates (Phase 13). See src/lib/ingestion/findEligibleCompanySources.ts, ' +
      'multiCompanyFeedUrls.ts, findCareerPageExtractionCandidates.ts.',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
    parameters: {
      method: 'POST',
      url: expr('{{ $json.appBaseUrl }}/api/internal/ingestion/list-sources'),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ {} }}'),
      options: { timeout: 30000 },
    },
  },
  output: [
    {
      sources: [{ source_id: 'sr-sa-alpaca', ats_type: 'greenhouse', feed_url: 'https://boards-api.greenhouse.io/v1/boards/alpaca/jobs?content=true' }],
      multi_company_sources: [{ provider_type: 'remoteok', feed_url: 'https://remoteok.com/api', paginated: false }],
      career_page_candidates: [{ source_id: 'sr-lb-byblos-bank', careers_url: 'https://www.byblosbank.com/bank-careers-lebanon' }],
    },
  ],
});

const logListSourcesFailure = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Log List Sources Failure',
    notes: 'Terminal failure for this run — nothing to loop over if source discovery itself failed. A human reviews the n8n execution log.',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'list-sources call failed' }}"), type: 'string' }] },
    },
  },
  output: [{ error: 'list-sources call failed' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Tier A: company-specific ATS sources (Greenhouse/Lever/Workable/Ashby/Oracle Cloud Recruiting)
// ─────────────────────────────────────────────────────────────────────────

const splitOutSources = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out Sources',
    parameters: { fieldToSplitOut: 'sources' },
  },
  output: [{ source_id: 'sr-qa-scale-ai', ats_type: 'greenhouse', feed_url: 'https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=true' }],
});

const loopSources = splitInBatches({
  version: 3,
  config: { name: 'Loop Sources (Rate Limited)', parameters: { batchSize: 1 } },
  output: [{ source_id: 'sr-qa-scale-ai', ats_type: 'greenhouse', feed_url: 'https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=true' }],
});

const fetchSourceJobs = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Source Jobs',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 4,
    waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: expr('{{ $json.feed_url }}'),
      authentication: 'none',
      options: { timeout: 15000 },
    },
  },
  output: [{ jobs: [{ id: 1, title: 'Sample Job', absolute_url: 'https://example.test/1', content: '<p>desc</p>', location: { name: 'Remote' } }] }],
});

const extractJobsByAtsType = switchCase({
  version: 3.4,
  config: {
    name: 'Extract Jobs By ATS Type',
    parameters: {
      rules: {
        values: [
          {
            outputKey: 'greenhouse',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Sources').item.json.ats_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'greenhouse' }],
              combinator: 'and',
            },
          },
          {
            outputKey: 'lever',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Sources').item.json.ats_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'lever' }],
              combinator: 'and',
            },
          },
          {
            outputKey: 'workable',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Sources').item.json.ats_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'workable' }],
              combinator: 'and',
            },
          },
          {
            outputKey: 'ashby',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Sources').item.json.ats_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'ashby' }],
              combinator: 'and',
            },
          },
          {
            outputKey: 'oracle_hcm',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Sources').item.json.ats_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'oracle_hcm' }],
              combinator: 'and',
            },
          },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Unsupported' },
    },
  },
  output: [{ jobs: [] }],
});

const extractGreenhouseJobs = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Extract Greenhouse Jobs',
    onError: 'continueErrorOutput',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ id: 'rawJobs', name: 'rawJobs', value: expr('{{ $json.jobs }}'), type: 'array' }] },
    },
  },
  output: [{ rawJobs: [] }],
});

// Lever's postings API returns a bare top-level array — n8n's core
// JSON-to-items conversion auto-splits it, so items are already individual
// raw jobs by the time they reach this branch (same behavior as RemoteOK's
// Tier D branch below). Confirmed live in Phase 14: a real 21-job Wahed
// response produced 21 separate items, each individually failing
// downstream, before this Aggregate node was added.
const aggregateLeverJobs = node({
  type: 'n8n-nodes-base.aggregate',
  version: 1,
  config: {
    name: 'Aggregate Lever Jobs',
    parameters: { aggregate: 'aggregateAllItemData', destinationFieldName: 'jobs', include: 'allFields' },
  },
  output: [{ jobs: [{ id: 'abc-123', text: 'Fixture Role' }] }],
});

const extractLeverJobs = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Extract Lever Jobs',
    notes: "Lever's postings API returns a bare top-level array, auto-split by n8n into one item per job — Aggregate Lever Jobs collects them back into a single {jobs:[...]} item before this node runs (Phase 14 fix; docs/job-ingestion-pilot.md §5).",
    onError: 'continueErrorOutput',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ id: 'rawJobs', name: 'rawJobs', value: expr('{{ $json.jobs }}'), type: 'array' }] },
    },
  },
  output: [{ rawJobs: [] }],
});

const extractWorkableJobs = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Extract Workable Jobs',
    onError: 'continueErrorOutput',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ id: 'rawJobs', name: 'rawJobs', value: expr('{{ $json.jobs }}'), type: 'array' }] },
    },
  },
  output: [{ rawJobs: [] }],
});

const extractAshbyJobs = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Extract Ashby Jobs',
    notes: 'Phase 13. Ashby posting-api returns {jobs:[...], apiVersion} — confirmed live against a real registry board (sr-qa-the-utopia-studio).',
    onError: 'continueErrorOutput',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ id: 'rawJobs', name: 'rawJobs', value: expr('{{ $json.jobs }}'), type: 'array' }] },
    },
  },
  output: [{ rawJobs: [] }],
});

// 2026-10-23 pagination-safety phase. Oracle's recruitingCEJobRequisitions
// response nests the real job list at items[0].requisitionList and carries
// no candidate-facing URL of its own (only internal hcmRestApi self-links)
// — the real, public apply URL lives at a sibling path, {host}/hcmUI/
// CandidateExperience/en/sites/{site}/job/{id}, confirmed live Phase 16
// (docs/LEBANON_GULF_SOURCE_RESEARCH.md §3).
//
// Also confirmed THIS phase (a real, bounded, live-approved test against
// AUBMC — see docs/LEBANON_LIVE_SOURCE_EXPANSION.md's own pagination
// section): the request's own `&limit=50` query parameter does NOT govern
// the real job-results page size — only the response's own
// items[0].Offset/items[0].Limit/items[0].TotalJobsCount can be trusted,
// and `finder=findReqs;siteNumber=X,offset=N` is the real, accepted,
// honored syntax for requesting a later page (the echoed-back Offset
// changed exactly as requested, and the result emptied out exactly as
// predicted once past the real total). A genuine second page of DISTINCT
// job content was never observed live (the one real tenant tested has
// fewer jobs than one page) — every multi-page safeguard below therefore
// fails CLOSED (keeps whatever was already safely accumulated, marks
// `paginationIncomplete`, stops asking for more) rather than assuming
// pagination "must be working" once more than one page is actually needed.
//
// This exact bounded-pagination algorithm is also implemented, independently
// testable, and unit-tested in src/lib/ingestion/oracleHcmPagination.ts —
// n8n expressions cannot import a project module at runtime, so the logic
// is deliberately duplicated here, the same pattern this workflow already
// uses for deriveAtsFeedUrl.ts's own candidateSiteUrl regex.
const ORACLE_HCM_MAX_PAGES = 10;

// 2026-10-24 corrective fix: moved from a Set-node inline expression into a
// Code node after an isolated n8n diagnostic (executions 300293/300549/
// 300782) proved Array.from(map.values()) AND the [...map.values()] spread
// form both silently return an empty array inside the Set-node inline-
// expression evaluator — even though the Map itself reports the correct
// size and every other field computed in the same scope is correct. The
// Code node's real JS sandbox does not share that defect. Mirrors
// classifyOracleHcmFirstPage in src/lib/ingestion/oracleHcmPagination.ts
// exactly, including that module's own 2026-10-24 fix: missing/invalid Ids
// are never collapsed into each other under a shared empty key, and an
// explicit integrity check fails closed if a merge step ever loses a valid
// Id (or returns empty despite non-empty inputs) instead of silently
// reporting success with fewer jobs than were actually seen.
const prepareOracleHcmPageState = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Oracle HCM Page State',
    notes:
      'Classifies the FIRST page (already fetched by the shared Fetch Source Jobs node above) using only the ' +
      "response's own items[0].{Offset,Limit,TotalJobsCount,requisitionList} — never the requested limit=50. A " +
      'malformed/unparseable response, or a merge that fails its own integrity check, fails closed ' +
      '(paginationIncomplete:true, zero jobs accumulated) rather than half-trusting it. See providers/oracle-hcm.ts, ' +
      "deriveAtsFeedUrl.ts, and src/lib/ingestion/oracleHcmPagination.ts's classifyOracleHcmFirstPage, which this " +
      'Code node mirrors exactly. Also throws (routed to its own error output, never silently) if it ever receives ' +
      'more than 1 input item — runOnceForAllItems + $input.first() would otherwise silently discard the rest; the ' +
      'current graph never sends it more than 1 (Loop Sources batchSize=1, no HTTP pagination on Fetch Source ' +
      'Jobs), but this guard makes that invariant fail loud instead of fail silent if it is ever broken.',
    onError: 'continueErrorOutput',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        'function hasValidRequisitionId(job) {\n' +
        '  var id = job ? job.Id : undefined;\n' +
        "  return id !== undefined && id !== null && String(id).trim() !== '';\n" +
        '}\n' +
        'function dedupeById(jobs) {\n' +
        '  var map = new Map();\n' +
        '  var missingIdCounter = 0;\n' +
        '  for (var i = 0; i < jobs.length; i++) {\n' +
        '    var job = jobs[i];\n' +
        "    var key = hasValidRequisitionId(job) ? ('id:' + String(job.Id)) : ('missing:' + (missingIdCounter++));\n" +
        '    map.set(key, job);\n' +
        '  }\n' +
        '  return Array.from(map.values());\n' +
        '}\n' +
        'function validRequisitionIds(jobs) {\n' +
        '  var ids = new Set();\n' +
        '  for (var i = 0; i < jobs.length; i++) {\n' +
        '    if (hasValidRequisitionId(jobs[i])) ids.add(String(jobs[i].Id));\n' +
        '  }\n' +
        '  return ids;\n' +
        '}\n' +
        'function mergeIncludesEveryValidId(priorJobs, newJobs, merged) {\n' +
        '  var expected = validRequisitionIds(priorJobs);\n' +
        '  validRequisitionIds(newJobs).forEach(function (id) { expected.add(id); });\n' +
        '  var actual = validRequisitionIds(merged);\n' +
        '  var ok = true;\n' +
        '  expected.forEach(function (id) { if (!actual.has(id)) ok = false; });\n' +
        '  if (!ok) return false;\n' +
        '  return !(merged.length === 0 && (priorJobs.length > 0 || newJobs.length > 0));\n' +
        '}\n' +
        '\n' +
        'const allInputItems = $input.all();\n' +
        'if (allInputItems.length !== 1) {\n' +
        "  throw new Error('Prepare Oracle HCM Page State expected exactly 1 input item but received ' + allInputItems.length + ' — refusing to process via $input.first() only, which would silently discard the rest.');\n" +
        '}\n' +
        'const input = allInputItems[0].json;\n' +
        "const feedUrl = $('Split Out Sources').item.json.feed_url;\n" +
        "const siteMatch = typeof feedUrl === 'string' ? feedUrl.match(/^https:\\/\\/([^/]+)\\/hcmRestApi.*siteNumber=([A-Za-z0-9_]+)/) : null;\n" +
        "const candidateSiteUrl = siteMatch ? ('https://' + siteMatch[1] + '/hcmUI/CandidateExperience/en/sites/' + siteMatch[2]) : null;\n" +
        '\n' +
        'const items = input.items;\n' +
        'const first = (Array.isArray(items) && items.length > 0) ? items[0] : null;\n' +
        'const offset = first ? first.Offset : undefined;\n' +
        'const limit = first ? first.Limit : undefined;\n' +
        'const totalJobsCount = first ? first.TotalJobsCount : undefined;\n' +
        'const requisitionList = first ? first.requisitionList : undefined;\n' +
        "const metaOk = typeof offset === 'number' && Number.isFinite(offset)\n" +
        "  && typeof limit === 'number' && Number.isFinite(limit)\n" +
        "  && typeof totalJobsCount === 'number' && Number.isFinite(totalJobsCount)\n" +
        '  && Array.isArray(requisitionList);\n' +
        '\n' +
        'if (!metaOk) {\n' +
        '  return [{ json: { pageState: { rawJobs: [], pageOffset: 0, pageLimit: 0, totalJobsCount: 0, pagesFetched: 1, paginationIncomplete: true, isComplete: false, candidateSiteUrl: candidateSiteUrl, feedUrl: feedUrl } } }];\n' +
        '}\n' +
        '\n' +
        'const stamped = requisitionList.map(function (job) { return Object.assign({}, job, { candidateSiteUrl: candidateSiteUrl }); });\n' +
        'const deduped = dedupeById(stamped);\n' +
        'if (!mergeIncludesEveryValidId([], stamped, deduped)) {\n' +
        '  return [{ json: { pageState: { rawJobs: [], pageOffset: 0, pageLimit: 0, totalJobsCount: 0, pagesFetched: 1, paginationIncomplete: true, isComplete: false, candidateSiteUrl: candidateSiteUrl, feedUrl: feedUrl } } }];\n' +
        '}\n' +
        '\n' +
        'const isComplete = (offset + requisitionList.length) >= totalJobsCount;\n' +
        'return [{ json: { pageState: { rawJobs: deduped, pageOffset: offset, pageLimit: limit, totalJobsCount: totalJobsCount, pagesFetched: 1, paginationIncomplete: false, isComplete: isComplete, candidateSiteUrl: candidateSiteUrl, feedUrl: feedUrl } } }];',
    },
  },
  output: [{ pageState: { rawJobs: [], pageOffset: 0, pageLimit: 25, totalJobsCount: 8, pagesFetched: 1, paginationIncomplete: false, isComplete: true } }],
});

// case 0 = already complete (or already known malformed) from page 1 alone
// — the real, live-tested AUBMC case (8 jobs, one page). Fallback = genuinely
// needs more pages, enters the bounded loop below.
const checkOracleHcmPage1Complete = switchCase({
  version: 3.4,
  config: {
    name: 'Check Oracle HCM Page 1 Complete?',
    parameters: {
      rules: {
        values: [
          {
            outputKey: 'done',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [
                { leftValue: expr('{{ $json.pageState.isComplete }}'), operator: { type: 'boolean', operation: 'equals' }, rightValue: true },
                { leftValue: expr('{{ $json.pageState.paginationIncomplete }}'), operator: { type: 'boolean', operation: 'equals' }, rightValue: true },
              ],
              combinator: 'or',
            },
          },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'needs_more_pages' },
    },
  },
  output: [{ pageState: { isComplete: true, paginationIncomplete: false } }],
});

// 2026-10-23 CORRECTIVE fix, replacing this phase's own first pagination
// attempt. An isolated, authorized n8n test (workflow 9UJQcvhgDQKWj8Ry,
// execution 299820) proved the original splitInBatches-based design was
// broken: `nextBatch()` does NOT carry mutated item state forward — the
// loop re-emits its own originally pre-built queued items every iteration
// (confirmed directly: three distinctly-seeded synthetic items came back
// with their ORIGINAL seed and an unmutated counter each time, never the
// previous iteration's incremented value). A fixed-attempts-array +
// splitInBatches loop is right for GulfTalent's poll loop (which never
// needs to mutate anything across attempts) but wrong here, where
// pageOffset/rawJobs genuinely must accumulate across iterations.
//
// Fix: a direct, self-referencing cycle (no splitInBatches at all) —
// Prepare Oracle HCM Next Page Request -> Fetch Oracle HCM Next Page ->
// Carry Forward Oracle HCM Page State (Merge, combineByPosition) -> Merge
// & Classify Oracle HCM Page -> Route Oracle HCM Page Outcome -> back to
// Prepare Oracle HCM Next Page Request. The Merge node is the SDK's own
// documented, proven mechanism for "a node's output replaces my data, but
// I need the pre-call data back afterward" (see get_sdk_reference's
// `independent_sources`/parallel-branches-plus-Merge pattern) — a
// pre-fetch Set node feeds Merge's input 0 UNCHANGED (never touched by the
// HTTP call), while Fetch Oracle HCM Next Page's success AND error outputs
// both feed Merge's input 1, so pageState is reliably present on every
// path reaching Merge & Classify regardless of what the HTTP node does to
// $json — no assumption about HTTP Request's replace-vs-preserve behavior
// is required at all. The page-count bound, previously provided for free
// by the fixed attempts array's own exhaustion, is now an explicit check
// inside Route Oracle HCM Page Outcome's own condition.
const prepareOracleHcmNextPageRequest = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Prepare Oracle HCM Next Page Request',
    notes:
      'Builds the next-page URL from the CURRENT pageState (always reliable here — this node runs BEFORE any HTTP ' +
      'call touches $json), adding offset=N as a finder variable, the same comma-separated placement as the existing ' +
      'siteNumber variable — the one live-confirmed syntax this phase\'s bounded test verified is accepted and ' +
      'honored. This exact item (pageState + nextPageUrl, untouched) also feeds Carry Forward Oracle HCM Page ' +
      "State's first input directly — see that node's own notes for why.",
    onError: 'continueErrorOutput',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'nextPageUrl',
            name: 'nextPageUrl',
            value: expr(
              '={{ (() => {\n' +
                '  const feedUrl = $json.pageState.feedUrl;\n' +
                '  const nextOffset = $json.pageState.pageOffset + $json.pageState.pageLimit;\n' +
                '  const m = feedUrl.match(/(finder=findReqs;siteNumber=[A-Za-z0-9_]+)/);\n' +
                "  return m ? feedUrl.replace(m[1], m[1] + ',offset=' + nextOffset) : null;\n" +
                '})() }}'
            ),
            type: 'string',
          },
        ],
      },
    },
  },
  output: [{ pageState: {}, nextPageUrl: 'https://x/hcmRestApi/resources/latest/recruitingCEJobRequisitions?finder=findReqs;siteNumber=CX_1,offset=25&expand=requisitionList&limit=50' }],
});

const fetchOracleHcmNextPage = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Oracle HCM Next Page',
    notes:
      'Free, idempotent read — safe to retry. A null nextPageUrl (feed_url shape unrecognized — defensive, never ' +
      "observed live) simply fails this request, which routes through the same error path as any other failure. " +
      "Both this node's success AND error outputs feed Carry Forward Oracle HCM Page State's second input — pageState " +
      "itself is recovered from that Merge node's OTHER (untouched) input regardless of which output fires here.",
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 4,
    waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: expr('{{ $json.nextPageUrl }}'),
      authentication: 'none',
      options: { timeout: 15000 },
    },
  },
  output: [{ items: [{ Offset: 25, Limit: 25, TotalJobsCount: 60, requisitionList: [] }] }],
});

// The SDK reference's own documented fix for "a node's output replaces my
// data, but a later node needs the pre-call data back" — see this file's
// header comment above. input(0) = the untouched pre-fetch item (pageState
// + nextPageUrl, never touched by the HTTP call). input(1) = whatever
// Fetch Oracle HCM Next Page produced, success OR error — Merge waits for
// both, so pageState is always present on the combined item reaching
// Merge & Classify below, with no assumption required about whether the
// HTTP node's own output preserves or replaces input fields.
const carryForwardOracleHcmPageState = merge({
  version: 3.2,
  config: {
    name: 'Carry Forward Oracle HCM Page State',
    parameters: { mode: 'combine', combineBy: 'combineByPosition', numberInputs: 2 },
  },
  output: [{ pageState: {}, nextPageUrl: 'https://x', items: [{ Offset: 25, Limit: 25, TotalJobsCount: 60, requisitionList: [] }] }],
});

// Shared, defensive last-resort fallback — reached only if Prepare Oracle
// HCM Next Page Request or Merge & Classify Oracle HCM Page itself throws
// unexpectedly (both already have their own defensive checks for every
// anticipated bad-input case; this is the explicit error-output handler
// requirement 5 of this phase's corrective fix calls for, not left
// silently dropped). Uses optional chaining throughout since, in this rare
// double-fault case, pageState's own shape is exactly what's in doubt.
const buildOracleHcmSafetyFallbackState = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Oracle HCM Safety Fallback State',
    notes: 'Never discards jobs it can still see — only loses already-accumulated jobs in the rare case pageState itself was unreadable, which is strictly safer than guessing.',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'pageState',
            name: 'pageState',
            value: expr('{{ { ...($json.pageState ?? {}), rawJobs: ($json.pageState?.rawJobs ?? []), paginationIncomplete: true, isComplete: false } }}'),
            type: 'object',
          },
        ],
      },
    },
  },
  output: [{ pageState: { paginationIncomplete: true, isComplete: false } }],
});

// 2026-10-24 corrective fix: moved from a Set-node inline expression into a
// Code node for the same reason as Prepare Oracle HCM Page State above (see
// that node's own comment) — the exact node most at risk, since THIS is the
// step that actually merges two pages' worth of jobs together.
const mergeClassifyOracleHcmPage = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Merge & Classify Oracle HCM Page',
    notes:
      "Mirrors classifyOracleHcmNextPage in src/lib/ingestion/oracleHcmPagination.ts (including that module's own " +
      '2026-10-24 fix: missing/invalid Ids are never collapsed into each other, and an explicit integrity check ' +
      'fails closed if a merge ever loses a valid Id or returns empty despite non-empty inputs), plus one ' +
      "n8n-specific check the pure module doesn't need (its caller already separates success/failure): " +
      "input.error, set by Carry Forward Oracle HCM Page State whenever Fetch Oracle HCM Next Page's error output " +
      'fired. Fails closed (keeps the prior accumulated rawJobs, forces paginationIncomplete, never merges the new ' +
      'page) on: a fetch failure; malformed metadata; a non-advancing/repeated offset (the API ignored our ' +
      'request); a premature empty page (0 items before the real reported total is reached); or the merge step ' +
      "itself failing its own integrity check. A genuinely-advancing page's items are de-duplicated by Oracle's " +
      'own raw Id against everything already accumulated. Its own error output is explicitly wired (see the ' +
      '2026-10-23 pre-import audit finding this corrective fix resolves) — never silently dropped. Also throws ' +
      '(routed to its own error output, never silently) if it ever receives more than 1 input item — ' +
      'runOnceForAllItems + $input.first() would otherwise silently discard the rest; the current graph never ' +
      'sends it more than 1 (single-item cycle, Merge combineByPosition pairs exactly 1:1), but this guard makes ' +
      'that invariant fail loud instead of fail silent if it is ever broken.',
    onError: 'continueErrorOutput',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        'function hasValidRequisitionId(job) {\n' +
        '  var id = job ? job.Id : undefined;\n' +
        "  return id !== undefined && id !== null && String(id).trim() !== '';\n" +
        '}\n' +
        'function dedupeById(jobs) {\n' +
        '  var map = new Map();\n' +
        '  var missingIdCounter = 0;\n' +
        '  for (var i = 0; i < jobs.length; i++) {\n' +
        '    var job = jobs[i];\n' +
        "    var key = hasValidRequisitionId(job) ? ('id:' + String(job.Id)) : ('missing:' + (missingIdCounter++));\n" +
        '    map.set(key, job);\n' +
        '  }\n' +
        '  return Array.from(map.values());\n' +
        '}\n' +
        'function validRequisitionIds(jobs) {\n' +
        '  var ids = new Set();\n' +
        '  for (var i = 0; i < jobs.length; i++) {\n' +
        '    if (hasValidRequisitionId(jobs[i])) ids.add(String(jobs[i].Id));\n' +
        '  }\n' +
        '  return ids;\n' +
        '}\n' +
        'function mergeIncludesEveryValidId(priorJobs, newJobs, merged) {\n' +
        '  var expected = validRequisitionIds(priorJobs);\n' +
        '  validRequisitionIds(newJobs).forEach(function (id) { expected.add(id); });\n' +
        '  var actual = validRequisitionIds(merged);\n' +
        '  var ok = true;\n' +
        '  expected.forEach(function (id) { if (!actual.has(id)) ok = false; });\n' +
        '  if (!ok) return false;\n' +
        '  return !(merged.length === 0 && (priorJobs.length > 0 || newJobs.length > 0));\n' +
        '}\n' +
        '\n' +
        'const allInputItems = $input.all();\n' +
        'if (allInputItems.length !== 1) {\n' +
        "  throw new Error('Merge & Classify Oracle HCM Page expected exactly 1 input item but received ' + allInputItems.length + ' — refusing to process via $input.first() only, which would silently discard the rest.');\n" +
        '}\n' +
        'const input = allInputItems[0].json;\n' +
        'const prior = input.pageState;\n' +
        '\n' +
        'if (input.error) {\n' +
        '  return [{ json: Object.assign({}, input, { pageState: Object.assign({}, prior, { paginationIncomplete: true, isComplete: false }) }) }];\n' +
        '}\n' +
        '\n' +
        'const items = input.items;\n' +
        'const first = (Array.isArray(items) && items.length > 0) ? items[0] : null;\n' +
        'const offset = first ? first.Offset : undefined;\n' +
        'const limit = first ? first.Limit : undefined;\n' +
        'const totalJobsCount = first ? first.TotalJobsCount : undefined;\n' +
        'const requisitionList = first ? first.requisitionList : undefined;\n' +
        "const metaOk = typeof offset === 'number' && Number.isFinite(offset)\n" +
        "  && typeof limit === 'number' && Number.isFinite(limit)\n" +
        "  && typeof totalJobsCount === 'number' && Number.isFinite(totalJobsCount)\n" +
        '  && Array.isArray(requisitionList);\n' +
        '\n' +
        'if (!metaOk) {\n' +
        '  return [{ json: Object.assign({}, input, { pageState: Object.assign({}, prior, { paginationIncomplete: true, isComplete: false }) }) }];\n' +
        '}\n' +
        '\n' +
        'const isNonAdvancingOffset = offset <= prior.pageOffset;\n' +
        'const isPrematureEmptyPage = requisitionList.length === 0 && offset < totalJobsCount;\n' +
        'if (isNonAdvancingOffset || isPrematureEmptyPage) {\n' +
        '  return [{ json: Object.assign({}, input, { pageState: Object.assign({}, prior, { paginationIncomplete: true, isComplete: false }) }) }];\n' +
        '}\n' +
        '\n' +
        'const stamped = requisitionList.map(function (job) { return Object.assign({}, job, { candidateSiteUrl: prior.candidateSiteUrl }); });\n' +
        'const merged = dedupeById(prior.rawJobs.concat(stamped));\n' +
        'if (!mergeIncludesEveryValidId(prior.rawJobs, stamped, merged)) {\n' +
        '  return [{ json: Object.assign({}, input, { pageState: Object.assign({}, prior, { paginationIncomplete: true, isComplete: false }) }) }];\n' +
        '}\n' +
        '\n' +
        'const isComplete = (offset + requisitionList.length) >= totalJobsCount;\n' +
        'return [{ json: Object.assign({}, input, { pageState: { rawJobs: merged, pageOffset: offset, pageLimit: limit, totalJobsCount: totalJobsCount, pagesFetched: prior.pagesFetched + 1, paginationIncomplete: false, isComplete: isComplete, candidateSiteUrl: prior.candidateSiteUrl, feedUrl: prior.feedUrl } }) }];',
    },
  },
  output: [{ pageState: { rawJobs: [], pageOffset: 25, pageLimit: 25, totalJobsCount: 60, pagesFetched: 2, paginationIncomplete: false, isComplete: false } }],
});

// case 0 = genuinely needs another page AND still under the bound (loop
// back, directly to Prepare Oracle HCM Next Page Request — no
// splitInBatches involved). case 1 = not complete, not failed, but the
// bound is exhausted (a real, explicit page-count check now that nothing
// else enforces one). Fallback = done — either isComplete (real success)
// or paginationIncomplete (a safeguard fired) — both exit with pageState
// already correct; the shared Call Ingestion Batch Endpoint reads it
// either way.
const routeOracleHcmPageOutcome = switchCase({
  version: 3.4,
  config: {
    name: 'Route Oracle HCM Page Outcome',
    parameters: {
      rules: {
        values: [
          {
            outputKey: 'continue',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [
                { leftValue: expr('{{ $json.pageState.paginationIncomplete }}'), operator: { type: 'boolean', operation: 'equals' }, rightValue: false },
                { leftValue: expr('{{ $json.pageState.isComplete }}'), operator: { type: 'boolean', operation: 'equals' }, rightValue: false },
                { leftValue: expr(`{{ $json.pageState.pagesFetched < ${ORACLE_HCM_MAX_PAGES} }}`), operator: { type: 'boolean', operation: 'equals' }, rightValue: true },
              ],
              combinator: 'and',
            },
          },
          {
            outputKey: 'bound_exhausted',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [
                { leftValue: expr('{{ $json.pageState.paginationIncomplete }}'), operator: { type: 'boolean', operation: 'equals' }, rightValue: false },
                { leftValue: expr('{{ $json.pageState.isComplete }}'), operator: { type: 'boolean', operation: 'equals' }, rightValue: false },
                { leftValue: expr(`{{ $json.pageState.pagesFetched >= ${ORACLE_HCM_MAX_PAGES} }}`), operator: { type: 'boolean', operation: 'equals' }, rightValue: true },
              ],
              combinator: 'and',
            },
          },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'exit' },
    },
  },
  output: [{ pageState: { isComplete: false, paginationIncomplete: false, pagesFetched: 2 } }],
});

// Reached only when ORACLE_HCM_MAX_PAGES was exhausted without ever seeing
// isComplete — by definition an incomplete retrieval, regardless of
// whatever pageState.paginationIncomplete already said.
const buildOracleHcmPaginationBoundExhausted = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Oracle HCM Pagination Bound Exhausted',
    notes: `Fired when ${ORACLE_HCM_MAX_PAGES} pages all passed without a completion signal. Whatever was accumulated within the bound is preserved — only paginationIncomplete is forced.`,
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          { id: 'pageState', name: 'pageState', value: expr('{{ { ...$json.pageState, paginationIncomplete: true, isComplete: false } }}'), type: 'object' },
        ],
      },
    },
  },
  output: [{ pageState: { paginationIncomplete: true, isComplete: false } }],
});

const SOURCE_ID_ASSIGNMENT = { id: 'source_id', name: 'source_id', value: expr("{{ $('Split Out Sources').item.json.source_id }}"), type: 'string' };
const ATS_TYPE_ASSIGNMENT = { id: 'ats_type', name: 'ats_type', value: expr("{{ $('Split Out Sources').item.json.ats_type }}"), type: 'string' };

const buildUnsupportedSourceResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Unsupported Source Result',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [SOURCE_ID_ASSIGNMENT, ATS_TYPE_ASSIGNMENT,
          { id: 'outcome', name: 'outcome', value: 'unsupported_ats_type', type: 'string' },
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'jobsFetched', name: 'jobsFetched', value: 0, type: 'number' },
          { id: 'jobsValid', name: 'jobsValid', value: 0, type: 'number' },
          { id: 'jobsRejected', name: 'jobsRejected', value: 0, type: 'number' },
          { id: 'jobsCreated', name: 'jobsCreated', value: 0, type: 'number' },
          { id: 'jobsUpdated', name: 'jobsUpdated', value: 0, type: 'number' },
          { id: 'jobsClosed', name: 'jobsClosed', value: 0, type: 'number' },
          { id: 'error', name: 'error', value: 'no adapter registered for this ats_type', type: 'string' },
        ],
      },
    },
  },
  output: [{ source_id: 'sr-x', ats_type: 'indeed', outcome: 'unsupported_ats_type', succeeded: false }],
});

const buildFetchFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Fetch Failure Result',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [SOURCE_ID_ASSIGNMENT, ATS_TYPE_ASSIGNMENT,
          { id: 'outcome', name: 'outcome', value: 'fetch_failed', type: 'string' },
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'jobsFetched', name: 'jobsFetched', value: 0, type: 'number' },
          { id: 'jobsValid', name: 'jobsValid', value: 0, type: 'number' },
          { id: 'jobsRejected', name: 'jobsRejected', value: 0, type: 'number' },
          { id: 'jobsCreated', name: 'jobsCreated', value: 0, type: 'number' },
          { id: 'jobsUpdated', name: 'jobsUpdated', value: 0, type: 'number' },
          { id: 'jobsClosed', name: 'jobsClosed', value: 0, type: 'number' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'fetch failed after retries' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ source_id: 'sr-x', ats_type: 'greenhouse', outcome: 'fetch_failed', succeeded: false }],
});

const callIngestionBatchEndpoint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call Ingestion Batch Endpoint',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/ingestion/run-batch"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '{{ {\n' +
          "  sourceId: $('Split Out Sources').item.json.source_id,\n" +
          "  sourceType: $('Split Out Sources').item.json.ats_type,\n" +
          // 2026-10-23 pagination-safety phase: Oracle HCM's branch carries its
          // rawJobs/incompleteness signal nested under pageState (see
          // Prepare Oracle HCM Page State above); every other ATS type still
          // sets a flat rawJobs field exactly as before — unaffected.
          '  rawJobs: $json.pageState ? $json.pageState.rawJobs : $json.rawJobs,\n' +
          '  paginationIncomplete: $json.pageState ? ($json.pageState.paginationIncomplete === true) : false,\n' +
          "  maxJobsPerSource: $('Workflow Configuration').first().json.maxJobsPerSource,\n" +
          "  dryRun: $('Workflow Configuration').first().json.dryRun\n" +
          '} }}'
      ),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
  },
  output: [{ outcome: 'succeeded', jobsFetched: 1, jobsValid: 1, jobsRejected: 0, jobsCreated: 1, jobsUpdated: 0, jobsClosed: 0, truncated: false }],
});

const buildSuccessResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Success Result',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [SOURCE_ID_ASSIGNMENT, ATS_TYPE_ASSIGNMENT,
          { id: 'succeeded', name: 'succeeded', value: expr("{{ $json.outcome === 'succeeded' }}"), type: 'boolean' },
          { id: 'error', name: 'error', value: null, type: 'string' },
        ],
      },
    },
  },
  output: [{ source_id: 'sr-x', ats_type: 'greenhouse', outcome: 'succeeded', succeeded: true, jobsFetched: 1, jobsValid: 1, jobsRejected: 0, jobsCreated: 1, jobsUpdated: 0, jobsClosed: 0, truncated: false, error: null }],
});

const buildEndpointFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Endpoint Failure Result',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [SOURCE_ID_ASSIGNMENT, ATS_TYPE_ASSIGNMENT,
          { id: 'outcome', name: 'outcome', value: 'endpoint_call_failed', type: 'string' },
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'jobsFetched', name: 'jobsFetched', value: 0, type: 'number' },
          { id: 'jobsValid', name: 'jobsValid', value: 0, type: 'number' },
          { id: 'jobsRejected', name: 'jobsRejected', value: 0, type: 'number' },
          { id: 'jobsCreated', name: 'jobsCreated', value: 0, type: 'number' },
          { id: 'jobsUpdated', name: 'jobsUpdated', value: 0, type: 'number' },
          { id: 'jobsClosed', name: 'jobsClosed', value: 0, type: 'number' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'ingestion batch endpoint call failed after retries' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ source_id: 'sr-x', ats_type: 'greenhouse', outcome: 'endpoint_call_failed', succeeded: false }],
});

const recordSourceResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Record Source Result',
    notes: "Pure convergence point — every per-source path (success, fetch failure, endpoint-call failure, unsupported ats_type) lands here with the same shape. Each iteration's outcome is visible in this node's own execution history in the n8n UI (no combined summary node — see the overview sticky note).",
    parameters: { mode: 'manual', includeOtherFields: true, assignments: { assignments: [] } },
  },
  output: [{ source_id: 'sr-x', ats_type: 'greenhouse', outcome: 'succeeded', succeeded: true }],
});

const rateLimitDelay = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Rate Limit Delay',
    parameters: {
      resume: 'timeInterval',
      amount: expr("{{ $('Workflow Configuration').first().json.rateLimitDelaySeconds }}"),
      unit: 'seconds',
    },
  },
  output: [{ source_id: 'sr-x' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Tier D (Phase 13): multi-company feeds (RemoteOK/Jobicy/Arbeitnow).
// Every branch normalizes to the same {jobs:[...]} shape before converging
// on one shared endpoint-call node — mirrors Tier A's
// extractGreenhouse/Lever/Workable/Ashby/OracleHcmJobs -> callIngestionBatchEndpoint
// convergence pattern above.
// ─────────────────────────────────────────────────────────────────────────

const splitOutMultiCompanySources = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out Multi-Company Sources',
    parameters: { fieldToSplitOut: 'multi_company_sources' },
  },
  output: [{ provider_type: 'remoteok', feed_url: 'https://remoteok.com/api', paginated: false }],
});

const loopMultiCompanySources = splitInBatches({
  version: 3,
  config: { name: 'Loop Multi-Company Sources (Rate Limited)', parameters: { batchSize: 1 } },
  output: [{ provider_type: 'remoteok', feed_url: 'https://remoteok.com/api', paginated: false }],
});

const fetchMultiCompanyFeed = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Multi-Company Feed',
    notes:
      'First page only, deliberately — Arbeitnow is the only paginated provider here and its remote:true jobs are a ' +
      'small subset of page 1; native HTTP pagination was judged not worth the added complexity this phase. See ' +
      'docs/PROVIDER_EXPANSION_IMPLEMENTATION.md.',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: expr('{{ $json.feed_url }}'),
      authentication: 'none',
      options: { timeout: 20000 },
    },
  },
  output: [{ id: '1137431', company: 'Fixture Co', position: 'Engineer', description: '<p>desc</p>', apply_url: 'https://remoteok.com/x', url: 'https://remoteok.com/x', date: '2026-09-01T00:00:00Z' }],
});

const extractRawJobsByProviderType = switchCase({
  version: 3.4,
  config: {
    name: 'Extract Raw Jobs By Provider Type',
    parameters: {
      rules: {
        values: [
          {
            outputKey: 'remoteok',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Multi-Company Sources').item.json.provider_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'remoteok' }],
              combinator: 'and',
            },
          },
          {
            outputKey: 'jobicy',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Multi-Company Sources').item.json.provider_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'jobicy' }],
              combinator: 'and',
            },
          },
          {
            outputKey: 'arbeitnow',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr("{{ $('Split Out Multi-Company Sources').item.json.provider_type }}"), operator: { type: 'string', operation: 'equals' }, rightValue: 'arbeitnow' }],
              combinator: 'and',
            },
          },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Unsupported' },
    },
  },
  output: [{ id: '1137431' }],
});

// RemoteOK's top-level response is a raw JSON array — n8n's core JSON-to-
// items conversion auto-splits it, so items are already individual raw
// jobs (item 0 is always RemoteOK's own legend/metadata object, which
// lacks id/company/title — harmlessly rejected downstream as
// missing_company_name, not filtered here, to keep this branch as simple
// as the other two).
const aggregateRemoteOkJobs = node({
  type: 'n8n-nodes-base.aggregate',
  version: 1,
  config: {
    name: 'Aggregate RemoteOK Jobs',
    parameters: { aggregate: 'aggregateAllItemData', destinationFieldName: 'jobs', include: 'allFields' },
  },
  output: [{ jobs: [{ id: '1137431', company: 'Fixture Co' }] }],
});

const splitOutJobicyJobs = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: { name: 'Split Out Jobicy Jobs', parameters: { fieldToSplitOut: 'jobs' } },
  output: [{ id: 151756, companyName: 'Fixture Co' }],
});

const aggregateJobicyJobs = node({
  type: 'n8n-nodes-base.aggregate',
  version: 1,
  config: {
    name: 'Aggregate Jobicy Jobs',
    parameters: { aggregate: 'aggregateAllItemData', destinationFieldName: 'jobs', include: 'allFields' },
  },
  output: [{ jobs: [{ id: 151756, companyName: 'Fixture Co' }] }],
});

const splitOutArbeitnowJobs = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: { name: 'Split Out Arbeitnow Jobs', parameters: { fieldToSplitOut: 'data' } },
  output: [{ slug: 'fixture-job', company_name: 'Fixture Co', remote: true }],
});

const filterArbeitnowRemote = node({
  type: 'n8n-nodes-base.filter',
  version: 2.3,
  config: {
    name: 'Filter Arbeitnow Remote Only',
    notes: "Arbeitnow's feed is dominated by DACH-region onsite listings — only remote:true rows are relevant to this project's international-remote lane (see docs/PROVIDER_EXPANSION_IMPLEMENTATION.md).",
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ leftValue: expr('{{ $json.remote }}'), operator: { type: 'boolean', operation: 'equals' }, rightValue: true }],
        combinator: 'and',
      },
      options: {},
    },
  },
  output: [{ slug: 'fixture-job', company_name: 'Fixture Co', remote: true }],
});

const aggregateArbeitnowJobs = node({
  type: 'n8n-nodes-base.aggregate',
  version: 1,
  config: {
    name: 'Aggregate Arbeitnow Jobs',
    parameters: { aggregate: 'aggregateAllItemData', destinationFieldName: 'jobs', include: 'allFields' },
  },
  output: [{ jobs: [{ slug: 'fixture-job', company_name: 'Fixture Co', remote: true }] }],
});

const callMultiCompanyBatchEndpoint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call Multi-Company Batch Endpoint',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/ingestion/run-multi-company-batch"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '{{ {\n' +
          "  sourceType: $('Split Out Multi-Company Sources').item.json.provider_type,\n" +
          '  rawJobs: $json.jobs,\n' +
          "  maxJobsPerSource: $('Workflow Configuration').first().json.maxJobsPerSource,\n" +
          "  dryRun: $('Workflow Configuration').first().json.dryRun\n" +
          '} }}'
      ),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
  },
  output: [{ outcome: 'succeeded', jobsFetched: 1, jobsValid: 1, jobsRejected: 0, jobsCreated: 1, jobsUpdated: 0, jobsClosed: 0, truncated: false }],
});

const MULTI_COMPANY_PROVIDER_TYPE_ASSIGNMENT = {
  id: 'provider_type',
  name: 'provider_type',
  value: expr("{{ $('Split Out Multi-Company Sources').item.json.provider_type }}"),
  type: 'string',
};

const buildMultiCompanySuccessResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Multi-Company Success Result',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [MULTI_COMPANY_PROVIDER_TYPE_ASSIGNMENT, { id: 'succeeded', name: 'succeeded', value: expr("{{ $json.outcome === 'succeeded' }}"), type: 'boolean' }, { id: 'error', name: 'error', value: null, type: 'string' }],
      },
    },
  },
  output: [{ provider_type: 'remoteok', outcome: 'succeeded', succeeded: true, error: null }],
});

const buildMultiCompanyFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Multi-Company Failure Result',
    notes: 'Shared failure builder for fetch failures, endpoint-call failures, and an unsupported provider_type (defensive — providerConfig.ts/multiCompanyFeedUrls.ts never actually emit one).',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          MULTI_COMPANY_PROVIDER_TYPE_ASSIGNMENT,
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'multi-company batch failed' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ provider_type: 'remoteok', succeeded: false, error: 'fetch failed after retries' }],
});

const recordMultiCompanySourceResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Record Multi-Company Source Result',
    notes: 'Convergence point for the Tier-D loop, same purpose as Record Source Result above — one execution-history entry per provider per run.',
    parameters: { mode: 'manual', includeOtherFields: true, assignments: { assignments: [] } },
  },
  output: [{ provider_type: 'remoteok', succeeded: true }],
});

const multiCompanyRateLimitDelay = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Multi-Company Rate Limit Delay',
    parameters: {
      resume: 'timeInterval',
      amount: expr("{{ $('Workflow Configuration').first().json.rateLimitDelaySeconds }}"),
      unit: 'seconds',
    },
  },
  output: [{ provider_type: 'remoteok' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Apify-sourced multi-company feeds (Phase 21): Bayt, GulfTalent, Indeed.
// These cannot go through the Tier D loop above — that loop's Fetch
// Multi-Company Feed node does a plain GET against a feed_url, while each
// of these needs a POST with a per-provider request body to Apify's
// run-sync-get-dataset-items endpoint (a fundamentally different HTTP
// shape) — so this is its own fully isolated branch (provider isolation),
// not an extra case bolted onto the Tier D switch. A static seed list, not
// dynamic discovery: these providers cannot be discovered the way
// getEnabledMultiCompanyFeedSources() discovers RemoteOK/Jobicy/Arbeitnow
// (it only ever builds GET feed URLs), so their markets are hardcoded here
// to exactly what Phase 21 live-benchmarked. Real per-provider findings —
// schema drift, apply-link provenance, GulfTalent needing a location hint
// for some markets — are documented in providers/bayt.ts, gulftalent.ts,
// indeed.ts and docs/LEBANON_LIVE_SOURCE_EXPANSION.md, not repeated here.
// ─────────────────────────────────────────────────────────────────────────

const apifyMultiCompanySourceSeeds = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Apify Multi-Company Source Seeds',
    notes:
      'Static seed list — bounded to the real markets live-benchmarked this phase (Bayt: Lebanon; Indeed: UAE/Dubai, ' +
      'Qatar, Kuwait). GulfTalent (Saudi + UAE/Dubai) moved OUT of this shared fast-sync seed list and loop — see ' +
      "GulfTalent Source Seeds below — because real evidence (two controlled test runs) proved this actor's real " +
      "completion time (32-125s observed) routinely exceeds Call Apify Actor's 60s HTTP timeout, discarding " +
      'successful, already-billed results. Bayt/Indeed stay on this fast synchronous path unchanged — their own ' +
      'real completion times have never exceeded a few seconds. refresh_scope: Bayt/Indeed keep their own ' +
      'independently-reviewed values (see each entry) — the GulfTalent cross-partition stale-close lesson that ' +
      'originally justified this field still applies to GulfTalent in its own new seed list below. ' +
      "max_jobs_per_run: each seed's own requested ingestion cap, read by Call Apify Batch Endpoint instead of the " +
      'global Workflow Configuration.maxJobsPerSource. Still clamped server-side against providerConfig.ts\'s ' +
      "maxJobsPerRun (40 for both) — this value can only ever be lowered by the server, never raised. " +
      'max_total_charge_usd: the real platform-level run-option cap for Call Apify Actor below, same mechanism ' +
      'already used for Call Data-Slayer Actor. Both remaining actors are real, confirmed PAY_PER_EVENT (free ' +
      'pricing-metadata GET, re-verified live) — each value here is the exact real cost of a fully-successful run ' +
      "at this seed's own max_jobs_per_run: the one-time apify-actor-start charge plus max_jobs_per_run x the " +
      'per-dataset-item charge (Bayt 0.0005 + 25x0.00099 = 0.02525; Indeed 0.0001 + 15x0.0001 = 0.0016 for each of ' +
      'its three seeds). The actor-start component is not an arbitrary buffer — omitting it would make the cap ' +
      'trigger before a run that returns exactly max_jobs_per_run items and behaves entirely within its configured ' +
      'bounds.',
    parameters: {
      mode: 'raw',
      jsonOutput: {
        apify_sources: [
          {
            provider_type: 'bayt',
            actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~bayt-scraper/run-sync-get-dataset-items',
            request_body: { country: 'LB', maxResults: 25 },
            refresh_scope: null,
            max_jobs_per_run: 25,
            max_total_charge_usd: 0.02525,
          },
          {
            provider_type: 'indeed',
            actor_url: 'https://api.apify.com/v2/acts/curious_coder~indeed-scraper/run-sync-get-dataset-items',
            request_body: { country: 'ae', location: 'Dubai', count: 15 },
            // Phase (market expansion) fix: was refresh_scope: null when
            // this was Indeed's only partition. Now that Qatar/Kuwait
            // seeds exist below sharing this same actor, null would make
            // all three share ONE stale-close partition — exactly the
            // cross-partition bug already found and fixed for GulfTalent's
            // two seeds (Phase 22). Given a real, stable, distinct value
            // instead, same pattern as GulfTalent.
            refresh_scope: 'country:ae',
            max_jobs_per_run: 15,
            max_total_charge_usd: 0.0016,
          },
          {
            // Qatar/Kuwait added per the market-expansion audit: Indeed's
            // own real, confirmed country enum (Phase 21 live benchmark,
            // the same zero-cost 400-rejection that proved Lebanon is NOT
            // supported) already includes both qa and kw — see
            // providers/indeed.ts's own header comment ("Gulf-capable
            // (bh, kw, om, qa, sa, ae)"). No new paid call was needed to
            // confirm this; it was already real evidence in this
            // codebase. Bayt/GulfTalent were NOT extended to Qatar/Kuwait
            // in this same pass: neither actor exposes a free, checkable
            // country enum, and neither has ever been real-tested beyond
            // the markets already live (Bayt: Lebanon; GulfTalent: SA/AE)
            // — adding them here would be guessing, not evidence.
            provider_type: 'indeed',
            actor_url: 'https://api.apify.com/v2/acts/curious_coder~indeed-scraper/run-sync-get-dataset-items',
            request_body: { country: 'qa', count: 15 },
            refresh_scope: 'country:qa',
            max_jobs_per_run: 15,
            max_total_charge_usd: 0.0016,
          },
          {
            provider_type: 'indeed',
            actor_url: 'https://api.apify.com/v2/acts/curious_coder~indeed-scraper/run-sync-get-dataset-items',
            request_body: { country: 'kw', count: 15 },
            refresh_scope: 'country:kw',
            max_jobs_per_run: 15,
            max_total_charge_usd: 0.0016,
          },
        ],
      },
    },
  },
  output: [
    {
      apify_sources: [
        {
          provider_type: 'bayt',
          actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~bayt-scraper/run-sync-get-dataset-items',
          request_body: { country: 'LB', maxResults: 25 },
          refresh_scope: null,
          max_jobs_per_run: 25,
          max_total_charge_usd: 0.02525,
        },
      ],
    },
  ],
});

const splitOutApifySources = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out Apify Sources',
    parameters: { fieldToSplitOut: 'apify_sources' },
  },
  output: [{ provider_type: 'bayt', actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~bayt-scraper/run-sync-get-dataset-items', request_body: { country: 'LB', maxResults: 25 }, max_total_charge_usd: 0.02525 }],
});

const loopApifySources = splitInBatches({
  version: 3,
  config: { name: 'Loop Apify Sources (Rate Limited)', parameters: { batchSize: 1 } },
  output: [{ provider_type: 'bayt', actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~bayt-scraper/run-sync-get-dataset-items', request_body: { country: 'LB', maxResults: 25 }, max_total_charge_usd: 0.02525 }],
});

const callApifyActor = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call Apify Actor',
    notes:
      "Credential 'AI Job Guide - Apify' must be bound manually in the n8n UI — programmatic credential binding for " +
      'generic-auth types on this node is a confirmed n8n MCP tool limitation (reported separately), not a project issue. ' +
      "retryOnFail is deliberately false (Phase 2 hardening fix, same reasoning already applied to Call Data-Slayer " +
      'Actor above): Bayt/Indeed are real, confirmed PAY_PER_EVENT actors (live-verified via a free ' +
      "pricing-metadata GET, same check Data-Slayer's own call uses) — a run-sync-get-dataset-items call is a paid, " +
      "non-idempotent external side effect, so a transport-level retry on this 60s-timeout node could start a second " +
      'full-price actor run while the first is still executing/billing (AGENTS.md §18 — never retry a non-idempotent ' +
      'paid action). Actor/network failure still reaches Build Apify Failure Result via onError below, unchanged. ' +
      "maxTotalChargeUsd (Phase 2 cost-safety fix): appended as a real platform-level run option, per-seed " +
      "max_total_charge_usd (Apify Multi-Company Source Seeds' own notes have the exact derivation) — the same " +
      'financial backstop Call Data-Slayer Actor already uses, now applied here too.',
    onError: 'continueErrorOutput',
    retryOnFail: false,
    parameters: {
      method: 'POST',
      url: expr("{{ $json.actor_url + '?maxTotalChargeUsd=' + $json.max_total_charge_usd }}"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ $json.request_body }}'),
      options: { timeout: 60000 },
    },
    credentials: { httpHeaderAuth: newCredential('AI Job Guide - Apify') },
  },
  output: [{ jobId: 'abc123', title: 'Accountant', company: 'Fixture Co' }],
});

const aggregateApifyJobs = node({
  type: 'n8n-nodes-base.aggregate',
  version: 1,
  config: {
    name: 'Aggregate Apify Jobs',
    notes:
      "Apify's run-sync-get-dataset-items returns a bare top-level array, same as Lever — n8n auto-splits it into one " +
      'item per job, so this re-aggregates back into one {jobs:[...]} item before the batch endpoint call (mirrors ' +
      'Aggregate Lever Jobs / Aggregate RemoteOK Jobs).',
    parameters: { aggregate: 'aggregateAllItemData', destinationFieldName: 'jobs', include: 'allFields' },
  },
  output: [{ jobs: [{ jobId: 'abc123', title: 'Accountant', company: 'Fixture Co' }] }],
});

const callApifyBatchEndpoint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call Apify Batch Endpoint',
    notes:
      'Same shared batch endpoint the Tier D branch uses — a separate node (not reused directly) because its ' +
      "sourceType expression must resolve $('Split Out Apify Sources'), a different ancestor than the Tier D branch's " +
      "$('Split Out Multi-Company Sources'). Credential 'Ingestion Worker Secret' must be bound manually in the n8n " +
      'UI, same confirmed MCP tool limitation as Call Apify Actor above.',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/ingestion/run-multi-company-batch"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '{{ {\n' +
          "  sourceType: $('Split Out Apify Sources').item.json.provider_type,\n" +
          '  rawJobs: $json.jobs,\n' +
          "  maxJobsPerSource: $('Split Out Apify Sources').item.json.max_jobs_per_run,\n" +
          "  dryRun: $('Workflow Configuration').first().json.dryRun,\n" +
          "  refreshScope: $('Split Out Apify Sources').item.json.refresh_scope ?? null\n" +
          '} }}'
      ),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
  },
  output: [{ outcome: 'succeeded', jobsFetched: 25, jobsValid: 25, jobsRejected: 0, jobsCreated: 25, jobsUpdated: 0, jobsClosed: 0, truncated: false }],
});

const APIFY_PROVIDER_TYPE_ASSIGNMENT = {
  id: 'provider_type',
  name: 'provider_type',
  value: expr("{{ $('Split Out Apify Sources').item.json.provider_type }}"),
  type: 'string',
};

const buildApifySuccessResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Apify Success Result',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [APIFY_PROVIDER_TYPE_ASSIGNMENT, { id: 'succeeded', name: 'succeeded', value: expr("{{ $json.outcome === 'succeeded' }}"), type: 'boolean' }, { id: 'error', name: 'error', value: null, type: 'string' }],
      },
    },
  },
  output: [{ provider_type: 'bayt', outcome: 'succeeded', succeeded: true, error: null }],
});

const buildApifyFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Apify Failure Result',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          APIFY_PROVIDER_TYPE_ASSIGNMENT,
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'apify actor or batch call failed' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ provider_type: 'bayt', succeeded: false, error: 'apify actor or batch call failed' }],
});

const recordApifySourceResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Record Apify Source Result',
    parameters: { mode: 'manual', includeOtherFields: true, assignments: { assignments: [] } },
  },
  output: [{ provider_type: 'bayt', succeeded: true }],
});

const apifyRateLimitDelay = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Apify Rate Limit Delay',
    parameters: {
      resume: 'timeInterval',
      amount: expr("{{ $('Workflow Configuration').first().json.rateLimitDelaySeconds }}"),
      unit: 'seconds',
    },
  },
  output: [{ provider_type: 'bayt' }],
});

// ─────────────────────────────────────────────────────────────────────────
// GulfTalent — async + bounded polling (reliability fix). Real evidence
// from two controlled test runs: GulfTalent's run-sync-get-dataset-items
// call took 32s/85s/112s/125s (3 of 4 real runs exceeded the shared Call
// Apify Actor node's 60s timeout), discarding already-billed, often
// already-SUCCEEDED results (~$0.025 wasted real spend across both runs).
// Bayt/Indeed never showed this problem (both consistently complete in a
// few seconds), so only GulfTalent is moved to this separate, slower-safe
// path — Bayt/Indeed's proven-reliable fast sync path above is untouched.
//
// Design: start the actor run ASYNCHRONOUSLY (POST .../runs, returns
// immediately with a run id + dataset id, no waiting) — this is the exact
// one-and-only paid, non-idempotent action per market per cycle
// (retryOnFail:false, same discipline as every other paid actor call in
// this workflow). Then poll the run's status via a FREE, idempotent GET
// (.../actor-runs/{id}) on a bounded loop: 15 attempts x 10s apart (150s
// total bound, comfortably above the largest real observed duration,
// 125s). Only once status is SUCCEEDED do we fetch the dataset items
// (also a free read of already-paid-for data) and persist. FAILED/
// TIMED-OUT/ABORTED or poll-exhaustion both record a clean failure and
// move on — never retried, never treated as evidence that existing
// GulfTalent jobs for that refresh_scope disappeared (the batch endpoint
// is simply never called for that partition this run, so nothing closes).
// ─────────────────────────────────────────────────────────────────────────

const GULFTALENT_POLL_MAX_ATTEMPTS = 15;
const GULFTALENT_POLL_DELAY_SECONDS = 10;

const gulfTalentSourceSeeds = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'GulfTalent Source Seeds',
    notes:
      'Static seed list, moved out of Apify Multi-Company Source Seeds above (see the async/polling note on this ' +
      "branch). actor_url is the bare actor resource (no /run-sync-get-dataset-items suffix) — Start GulfTalent " +
      "Actor Run below appends /runs itself. Saudi + UAE/Dubai limits (maxResults:15 each) and " +
      'max_total_charge_usd (0.0155 each, unchanged derivation: 0.005 actor-start + 15x0.0007/item) are identical ' +
      'to before this fix — this is a reliability fix, not a volume or cost-cap change. refresh_scope stays ' +
      'distinct per entry (country:SA / country:AE:location:Dubai) — the original cross-partition stale-close ' +
      'lesson this field exists for still applies here unchanged.',
    parameters: {
      mode: 'raw',
      jsonOutput: {
        gulftalent_sources: [
          {
            provider_type: 'gulftalent',
            actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~gulftalent-scraper',
            request_body: { country: 'SA', maxResults: 15 },
            refresh_scope: 'country:SA',
            max_jobs_per_run: 15,
            max_total_charge_usd: 0.0155,
          },
          {
            provider_type: 'gulftalent',
            actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~gulftalent-scraper',
            request_body: { country: 'AE', location: 'Dubai', maxResults: 15 },
            refresh_scope: 'country:AE:location:Dubai',
            max_jobs_per_run: 15,
            max_total_charge_usd: 0.0155,
          },
        ],
      },
    },
  },
  output: [
    {
      gulftalent_sources: [
        { provider_type: 'gulftalent', actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~gulftalent-scraper', request_body: { country: 'SA', maxResults: 15 }, refresh_scope: 'country:SA', max_jobs_per_run: 15, max_total_charge_usd: 0.0155 },
      ],
    },
  ],
});

const splitOutGulfTalentSources = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out GulfTalent Sources',
    parameters: { fieldToSplitOut: 'gulftalent_sources' },
  },
  output: [{ provider_type: 'gulftalent', actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~gulftalent-scraper', request_body: { country: 'SA', maxResults: 15 }, refresh_scope: 'country:SA', max_jobs_per_run: 15, max_total_charge_usd: 0.0155 }],
});

const loopGulfTalentSources = splitInBatches({
  version: 3,
  config: { name: 'Loop GulfTalent Sources (Rate Limited)', parameters: { batchSize: 1 } },
  output: [{ provider_type: 'gulftalent', actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~gulftalent-scraper', request_body: { country: 'SA', maxResults: 15 }, refresh_scope: 'country:SA', max_jobs_per_run: 15, max_total_charge_usd: 0.0155 }],
});

// The ONE paid, non-idempotent action per market per cycle. Returns
// immediately (run id + dataset id) — does not wait for the actor to
// finish, so this node's own timeout only needs to cover Apify accepting
// the start request, never the actor's real runtime. retryOnFail is
// deliberately false, same AGENTS.md §18 reasoning as every other paid
// actor-start node in this workflow — a transport-level retry here could
// start a second full-price run while the first is already billing.
// Credential 'AI Job Guide - Apify' must be bound manually in the n8n UI
// (confirmed MCP tool limitation, same as every other generic-auth node
// added this way in this workflow).
const startGulfTalentActorRun = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Start GulfTalent Actor Run',
    notes:
      'Async run start (POST .../runs), not run-sync-get-dataset-items — returns immediately with {id, ' +
      'defaultDatasetId, status}, before the actor has necessarily finished. maxTotalChargeUsd is the same real ' +
      "platform-level run-option cap as before (per-seed max_total_charge_usd, unchanged 0.0155) — it bounds this " +
      'run exactly like every other paid actor call in this workflow, independent of whether the caller waits ' +
      'synchronously or polls asynchronously for the result.',
    onError: 'continueErrorOutput',
    retryOnFail: false,
    parameters: {
      method: 'POST',
      url: expr("{{ $json.actor_url + '/runs?maxTotalChargeUsd=' + $json.max_total_charge_usd }}"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ $json.request_body }}'),
      options: { timeout: 20000 },
    },
    credentials: { httpHeaderAuth: newCredential('AI Job Guide - Apify') },
  },
  output: [{ id: 'runAbc123', defaultDatasetId: 'datasetAbc123', status: 'READY' }],
});

const buildGulfTalentStartFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build GulfTalent Start Failure Result',
    notes: 'The paid start call itself failed (network/4xx/5xx) — no run was created, nothing to poll, nothing persisted, nothing closed.',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'provider_type', name: 'provider_type', value: 'gulftalent', type: 'string' },
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'gulftalent actor start failed' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ provider_type: 'gulftalent', succeeded: false, error: 'gulftalent actor start failed' }],
});

const prepareGulfTalentPollAttempts = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Prepare GulfTalent Poll Attempts',
    notes:
      `Builds a fixed, bounded array of ${GULFTALENT_POLL_MAX_ATTEMPTS} poll-attempt placeholders — Split Out GulfTalent Poll Attempts below explodes it into one loop item per attempt, each carrying runId/datasetId forward via 'include other fields'. ` +
      "Uses '?.' on $json.data — a successful actor-start response missing the data envelope entirely must never throw an uncaught expression error here (this node has no onError wired); " +
      'Check GulfTalent Actor Start Run ID Valid? below is what actually rejects a missing/invalid runId before it can reach the paid-adjacent polling HTTP node.',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'runId', name: 'runId', value: expr('{{ $json.data?.id }}'), type: 'string' },
          { id: 'datasetId', name: 'datasetId', value: expr('{{ $json.data?.defaultDatasetId }}'), type: 'string' },
          { id: 'poll_attempts', name: 'poll_attempts', value: expr(`{{ Array.from({ length: ${GULFTALENT_POLL_MAX_ATTEMPTS} }, (_, i) => i) }}`), type: 'array' },
        ],
      },
    },
  },
  output: [{ runId: 'runAbc123', datasetId: 'datasetAbc123', poll_attempts: [0, 1, 2] }],
});

// Rejects a missing/null actor-start data envelope and a missing, empty,
// or non-string runId BEFORE the free-but-real polling HTTP call —
// Poll GulfTalent Run Status's URL is built from exactly this field
// ('https://api.apify.com/v2/actor-runs/' + $json.runId), so an invalid
// runId here would otherwise silently become a wrong-but-valid URL
// (.../actor-runs/undefined) instead of a clean, actionable rejection.
// Reuses the same string-equals + fallbackOutput pattern already proven
// by Check GulfTalent Run Terminal? below — no new condition syntax.
const checkGulfTalentActorStartRunIdValid = switchCase({
  version: 3.4,
  config: {
    name: 'Check GulfTalent Actor Start Run ID Valid?',
    notes:
      'Only runId is checked here — datasetId from this same actor-start response is never actually read by Fetch GulfTalent Dataset Items (that node reads the TERMINAL poll response\'s own data.defaultDatasetId instead, checked separately by Check GulfTalent Terminal Dataset ID Valid? below), so validating it here would guard a field nothing consumes.',
    parameters: {
      rules: {
        values: [
          {
            outputKey: 'valid',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [
                {
                  leftValue: expr("{{ (typeof $json.runId === 'string' && $json.runId.trim().length > 0) ? 'valid' : 'invalid' }}"),
                  operator: { type: 'string', operation: 'equals' },
                  rightValue: 'valid',
                },
              ],
              combinator: 'and',
            },
          },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'invalid' },
    },
  },
  output: [{ runId: 'runAbc123', datasetId: 'datasetAbc123', poll_attempts: [0, 1, 2] }],
});

const buildGulfTalentInvalidActorStartIdResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build GulfTalent Invalid Actor Start ID Result',
    notes: 'The actor-start HTTP call itself succeeded, but its response lacked a usable run ID (missing data envelope, or missing/empty/non-string data.id) — nothing to poll, nothing persisted, nothing closed. Never retried, never reaches the batch endpoint, and never restarts the actor.',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'provider_type', name: 'provider_type', value: 'gulftalent', type: 'string' },
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'error', name: 'error', value: 'gulftalent actor-start response missing a valid run ID', type: 'string' },
        ],
      },
    },
  },
  output: [{ provider_type: 'gulftalent', succeeded: false, error: 'gulftalent actor-start response missing a valid run ID' }],
});

const splitOutGulfTalentPollAttempts = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out GulfTalent Poll Attempts',
    parameters: { fieldToSplitOut: 'poll_attempts', include: 'allOtherFields' },
  },
  output: [{ runId: 'runAbc123', datasetId: 'datasetAbc123', poll_attempts: 0 }],
});

const loopGulfTalentPoll = splitInBatches({
  version: 3,
  config: { name: 'Loop GulfTalent Poll Attempts (Bounded)', parameters: { batchSize: 1 } },
  output: [{ runId: 'runAbc123', datasetId: 'datasetAbc123', poll_attempts: 0 }],
});

const gulfTalentPollDelay = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'GulfTalent Poll Delay',
    notes: `Fixed ${GULFTALENT_POLL_DELAY_SECONDS}s between polls — a reviewed constant, not derived from Workflow Configuration's generic rateLimitDelaySeconds (that value rate-limits between different SOURCES, a different concern from polling the SAME run's status).`,
    parameters: { resume: 'timeInterval', amount: GULFTALENT_POLL_DELAY_SECONDS, unit: 'seconds' },
  },
  output: [{ runId: 'runAbc123', datasetId: 'datasetAbc123' }],
});

// Free, idempotent status read — safe to retry on transient network
// blips (unlike the paid start call above). A failure here after retries
// is treated as "inconclusive this tick", not as actor failure — it just
// continues to the next poll tick via its error path too, since the
// underlying run may well still be fine even if this one status check
// could not be confirmed.
const pollGulfTalentRunStatus = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Poll GulfTalent Run Status',
    notes: "Credential 'AI Job Guide - Apify' must be bound manually in the n8n UI, same confirmed MCP tool limitation as every other generic-auth node added this way. Never starts or restarts the actor — read-only run metadata.",
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'GET',
      url: expr("{{ 'https://api.apify.com/v2/actor-runs/' + $json.runId }}"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: { timeout: 15000 },
    },
    credentials: { httpHeaderAuth: newCredential('AI Job Guide - Apify') },
  },
  output: [{ data: { id: 'runAbc123', status: 'SUCCEEDED', defaultDatasetId: 'datasetAbc123' } }],
});

// Routes on the run's real status string (confirmed live this phase via
// free run-metadata reads on two real executions: SUCCEEDED/FAILED were
// both observed exactly as Apify's own documented terminal values).
// case 0 = SUCCEEDED → fetch the dataset. case 1 = a real terminal
// failure (FAILED/TIMED-OUT/ABORTED) → record failure, never retried.
// Fallback (READY/RUNNING/anything else, and the error-output path from
// Poll GulfTalent Run Status above) = still in flight or inconclusive →
// loop back for another poll, bounded by the outer attempt count.
const checkGulfTalentPollTerminal = switchCase({
  version: 3.4,
  config: {
    name: 'Check GulfTalent Run Terminal?',
    parameters: {
      rules: {
        values: [
          {
            outputKey: 'succeeded',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr('{{ $json.data.status }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'SUCCEEDED' }],
              combinator: 'and',
            },
          },
          {
            outputKey: 'terminal_failure',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [
                { leftValue: expr('{{ $json.data.status }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'FAILED' },
                { leftValue: expr('{{ $json.data.status }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'TIMED-OUT' },
                { leftValue: expr('{{ $json.data.status }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'ABORTED' },
              ],
              combinator: 'or',
            },
          },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'still_running' },
    },
  },
  output: [{ data: { id: 'runAbc123', status: 'SUCCEEDED', defaultDatasetId: 'datasetAbc123' } }],
});

const buildGulfTalentTerminalFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build GulfTalent Terminal Failure Result',
    notes: 'A real terminal failure (FAILED/TIMED-OUT/ABORTED) reported by Apify itself — never retried, never treated as evidence existing jobs for this refresh_scope disappeared.',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'provider_type', name: 'provider_type', value: 'gulftalent', type: 'string' },
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'error', name: 'error', value: expr("{{ 'gulftalent actor run ended ' + ($json.data?.status ?? 'unknown') }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ provider_type: 'gulftalent', succeeded: false, error: 'gulftalent actor run ended FAILED' }],
});

const buildGulfTalentPollTimeoutResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build GulfTalent Poll Timeout Result',
    notes:
      `Fired when ${GULFTALENT_POLL_MAX_ATTEMPTS} poll attempts (${GULFTALENT_POLL_MAX_ATTEMPTS * GULFTALENT_POLL_DELAY_SECONDS}s bound) all passed without a terminal status. References the outer loop's own seed item ` +
      "(Split Out GulfTalent Sources), not whatever shape splitInBatches' done output happens to carry, so this stays correct regardless of that. The run may still complete later on Apify's side — " +
      'that possibility is exactly why the actor is never restarted here, only the batch endpoint call for this cycle is skipped.',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'provider_type', name: 'provider_type', value: 'gulftalent', type: 'string' },
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'error', name: 'error', value: `gulftalent poll limit exhausted after ${GULFTALENT_POLL_MAX_ATTEMPTS} attempts — run may still be in progress on Apify`, type: 'string' },
        ],
      },
    },
  },
  output: [{ provider_type: 'gulftalent', succeeded: false, error: 'gulftalent poll limit exhausted after 15 attempts' }],
});

// Rejects a missing, empty, or non-string dataset ID from the TERMINAL
// (SUCCEEDED) poll response BEFORE the free-but-real dataset-fetch HTTP
// call — Fetch GulfTalent Dataset Items's URL is built from exactly this
// field. Deliberately re-checks data.defaultDatasetId from THIS response,
// not the actor-start response's own (unused) datasetId field — see
// Check GulfTalent Actor Start Run ID Valid?'s own note on why those two
// are not assumed identical. Uses '?.' for the same missing-data-envelope
// safety as Build GulfTalent Terminal Failure Result above.
const checkGulfTalentTerminalDatasetIdValid = switchCase({
  version: 3.4,
  config: {
    name: 'Check GulfTalent Terminal Dataset ID Valid?',
    notes: 'Reached only from the SUCCEEDED case of Check GulfTalent Run Terminal? above — still defensively re-checks data.defaultDatasetId rather than assuming a SUCCEEDED status guarantees a usable dataset ID.',
    parameters: {
      rules: {
        values: [
          {
            outputKey: 'valid',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [
                {
                  leftValue: expr("{{ (typeof $json.data?.defaultDatasetId === 'string' && $json.data.defaultDatasetId.trim().length > 0) ? 'valid' : 'invalid' }}"),
                  operator: { type: 'string', operation: 'equals' },
                  rightValue: 'valid',
                },
              ],
              combinator: 'and',
            },
          },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'invalid' },
    },
  },
  output: [{ data: { id: 'runAbc123', status: 'SUCCEEDED', defaultDatasetId: 'datasetAbc123' } }],
});

const buildGulfTalentInvalidDatasetIdResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build GulfTalent Invalid Dataset ID Result',
    notes: 'The actor run itself reported SUCCEEDED, but its terminal response lacked a usable dataset ID — nothing is fetched, nothing persisted, nothing closed. Never retried, never reaches the batch endpoint, and never restarts the actor.',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'provider_type', name: 'provider_type', value: 'gulftalent', type: 'string' },
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'error', name: 'error', value: 'gulftalent terminal response missing a valid dataset ID', type: 'string' },
        ],
      },
    },
  },
  output: [{ provider_type: 'gulftalent', succeeded: false, error: 'gulftalent terminal response missing a valid dataset ID' }],
});

// Free read of already-paid-for data — same dataset the run already
// billed for, no new cost. Reached only when status === SUCCEEDED.
const fetchGulfTalentDatasetItems = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch GulfTalent Dataset Items',
    notes: "Credential 'AI Job Guide - Apify' must be bound manually in the n8n UI, same confirmed MCP tool limitation as every other generic-auth node added this way.",
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'GET',
      url: expr("{{ 'https://api.apify.com/v2/datasets/' + $json.data.defaultDatasetId + '/items' }}"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: { timeout: 30000 },
    },
    credentials: { httpHeaderAuth: newCredential('AI Job Guide - Apify') },
  },
  output: [{ jobId: 'abc123', title: 'Accountant', company: 'Fixture Co' }],
});

const buildGulfTalentDatasetFetchFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build GulfTalent Dataset Fetch Failure Result',
    notes: 'Rare edge case: the actor run itself succeeded, but reading its already-generated dataset failed. No new cost either way — nothing is persisted this cycle, nothing is closed.',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'provider_type', name: 'provider_type', value: 'gulftalent', type: 'string' },
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'gulftalent dataset fetch failed after actor succeeded' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ provider_type: 'gulftalent', succeeded: false, error: 'gulftalent dataset fetch failed' }],
});

const aggregateGulfTalentJobs = node({
  type: 'n8n-nodes-base.aggregate',
  version: 1,
  config: {
    name: 'Aggregate GulfTalent Jobs',
    notes: "Same bare-top-level-array reshape as Aggregate Apify Jobs — run's dataset-items GET returns an array, n8n auto-splits it, this re-aggregates before the batch endpoint call.",
    parameters: { aggregate: 'aggregateAllItemData', destinationFieldName: 'jobs', include: 'allFields' },
  },
  output: [{ jobs: [{ jobId: 'abc123', title: 'Accountant', company: 'Fixture Co' }] }],
});

const callGulfTalentBatchEndpoint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call GulfTalent Batch Endpoint',
    notes:
      'Same shared run-multi-company-batch endpoint every other multi-company/Apify branch uses — no duplicate ' +
      "persistence model. Credential 'Ingestion Worker Secret' must be bound manually in the n8n UI, same " +
      'confirmed MCP tool limitation as Call Apify Batch Endpoint above.',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/ingestion/run-multi-company-batch"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '{{ {\n' +
          "  sourceType: $('Split Out GulfTalent Sources').item.json.provider_type,\n" +
          '  rawJobs: $json.jobs,\n' +
          "  maxJobsPerSource: $('Split Out GulfTalent Sources').item.json.max_jobs_per_run,\n" +
          "  dryRun: $('Workflow Configuration').first().json.dryRun,\n" +
          "  refreshScope: $('Split Out GulfTalent Sources').item.json.refresh_scope ?? null\n" +
          '} }}'
      ),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
  },
  output: [{ outcome: 'succeeded', jobsFetched: 15, jobsValid: 15, jobsRejected: 0, jobsCreated: 15, jobsUpdated: 0, jobsClosed: 0, truncated: false }],
});

const GULFTALENT_PROVIDER_TYPE_ASSIGNMENT = {
  id: 'provider_type',
  name: 'provider_type',
  value: expr("{{ $('Split Out GulfTalent Sources').item.json.provider_type }}"),
  type: 'string',
};

const buildGulfTalentSuccessResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build GulfTalent Success Result',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [GULFTALENT_PROVIDER_TYPE_ASSIGNMENT, { id: 'succeeded', name: 'succeeded', value: expr("{{ $json.outcome === 'succeeded' }}"), type: 'boolean' }, { id: 'error', name: 'error', value: null, type: 'string' }],
      },
    },
  },
  output: [{ provider_type: 'gulftalent', outcome: 'succeeded', succeeded: true, error: null }],
});

const buildGulfTalentBatchFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build GulfTalent Batch Failure Result',
    notes: 'The batch persistence call itself failed after a successfully-fetched dataset — distinct from the actor-level failure builders above.',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          GULFTALENT_PROVIDER_TYPE_ASSIGNMENT,
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'gulftalent batch endpoint call failed' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ provider_type: 'gulftalent', succeeded: false, error: 'gulftalent batch endpoint call failed' }],
});

const recordGulfTalentSourceResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Record GulfTalent Source Result',
    notes:
      "Its own convergence point, deliberately NOT sharing Record Apify Source Result above — that node's own " +
      "outgoing wire already loops back into Loop Apify Sources (Rate Limited), a DIFFERENT loop than GulfTalent's " +
      'own. A single node can only have one outgoing wire, so GulfTalent needs its own record/delay/loop-back, ' +
      'fully independent from the Bayt/Indeed branch, consistent with every other source family in this workflow.',
    parameters: { mode: 'manual', includeOtherFields: true, assignments: { assignments: [] } },
  },
  output: [{ provider_type: 'gulftalent', succeeded: true }],
});

const gulfTalentRateLimitDelay = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'GulfTalent Rate Limit Delay',
    parameters: {
      resume: 'timeInterval',
      amount: expr("{{ $('Workflow Configuration').first().json.rateLimitDelaySeconds }}"),
      unit: 'seconds',
    },
  },
  output: [{ provider_type: 'gulftalent' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Tier B (Phase 13): career-page extraction. Company-specific (one
// company_sources row each), so it reuses the SAME
// /api/internal/ingestion/run-batch endpoint as Tier A above — the only
// new step is fetching + extracting HTML before that call.
// ─────────────────────────────────────────────────────────────────────────

const splitOutCareerPageCandidates = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out Career Page Candidates',
    parameters: { fieldToSplitOut: 'career_page_candidates' },
  },
  output: [{ source_id: 'sr-lb-byblos-bank', careers_url: 'https://www.byblosbank.com/bank-careers-lebanon' }],
});

const loopCareerPageCandidates = splitInBatches({
  version: 3,
  config: { name: 'Loop Career Page Candidates (Rate Limited)', parameters: { batchSize: 1 } },
  output: [{ source_id: 'sr-lb-byblos-bank', careers_url: 'https://www.byblosbank.com/bank-careers-lebanon' }],
});

const fetchCareerPageHtml = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Career Page HTML',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    parameters: {
      method: 'GET',
      url: expr('{{ $json.careers_url }}'),
      authentication: 'none',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'User-Agent', value: 'Mozilla/5.0 (compatible; ai-job-agent-ingestion/1.0)' }] },
      options: { timeout: 20000, response: { response: { responseFormat: 'text', outputPropertyName: 'html' } } },
    },
  },
  output: [{ html: '<html><body>Careers page</body></html>' }],
});

const callExtractCareerPageJobsEndpoint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call Extract Career Page Jobs Endpoint',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/ingestion/extract-career-page-jobs"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ { html: $json.html } }}'),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
  },
  output: [{ jobs: [] }],
});

const callCareerPageIngestionBatchEndpoint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call Career Page Ingestion Batch Endpoint',
    notes: 'Same shared run-batch endpoint Tier A calls — career_page is a company-specific source_type (jobs.source_type check constraint already allowed it before Phase 13).',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/ingestion/run-batch"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '{{ {\n' +
          "  sourceId: $('Split Out Career Page Candidates').item.json.source_id,\n" +
          "  sourceType: 'career_page',\n" +
          '  rawJobs: $json.jobs,\n' +
          "  maxJobsPerSource: $('Workflow Configuration').first().json.maxJobsPerSource,\n" +
          "  dryRun: $('Workflow Configuration').first().json.dryRun\n" +
          '} }}'
      ),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
  },
  output: [{ outcome: 'no_valid_jobs', jobsFetched: 0, jobsValid: 0, jobsRejected: 0, jobsCreated: 0, jobsUpdated: 0, jobsClosed: 0, truncated: false }],
});

const CAREER_PAGE_SOURCE_ID_ASSIGNMENT = {
  id: 'source_id',
  name: 'source_id',
  value: expr("{{ $('Split Out Career Page Candidates').item.json.source_id }}"),
  type: 'string',
};

const buildCareerPageSuccessResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Career Page Success Result',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [CAREER_PAGE_SOURCE_ID_ASSIGNMENT, { id: 'succeeded', name: 'succeeded', value: expr("{{ $json.outcome === 'succeeded' || $json.outcome === 'no_valid_jobs' }}"), type: 'boolean' }, { id: 'error', name: 'error', value: null, type: 'string' }],
      },
    },
  },
  output: [{ source_id: 'sr-lb-byblos-bank', outcome: 'no_valid_jobs', succeeded: true, error: null }],
});

const buildCareerPageFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Career Page Failure Result',
    notes: 'Shared failure builder for HTML-fetch failures, extraction-endpoint failures, and ingestion-batch-endpoint failures.',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          CAREER_PAGE_SOURCE_ID_ASSIGNMENT,
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'career page ingestion failed' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ source_id: 'sr-lb-byblos-bank', succeeded: false, error: 'fetch failed after retries' }],
});

const recordCareerPageSourceResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Record Career Page Source Result',
    notes: 'Convergence point for the Tier-B loop, same purpose as Record Source Result above.',
    parameters: { mode: 'manual', includeOtherFields: true, assignments: { assignments: [] } },
  },
  output: [{ source_id: 'sr-lb-byblos-bank', succeeded: true }],
});

const careerPageRateLimitDelay = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Career Page Rate Limit Delay',
    parameters: {
      resume: 'timeInterval',
      amount: expr("{{ $('Workflow Configuration').first().json.rateLimitDelaySeconds }}"),
      unit: 'seconds',
    },
  },
  output: [{ source_id: 'sr-lb-byblos-bank' }],
});

// ─────────────────────────────────────────────────────────────────────────
// Sticky notes
// ─────────────────────────────────────────────────────────────────────────

const overviewNote = sticky(
  '### AI Job Guide / 01 Job Ingestion\n' +
    'Manual trigger, stays inactive until a human reviews a `local_pilot`-equivalent run (dryRun:false) and decides on a schedule. ' +
    'n8n owns provider HTTP calls + retry/backoff (native `retryOnFail`) + per-source rate limiting; ALL validation, ' +
    'field mapping, dedup identity, idempotent persistence, and stale-close safety live in src/lib/ingestion/* (Phase 03) ' +
    "behind three internal endpoints (run-batch, run-multi-company-batch, extract-career-page-jobs), which also re-verify " +
    'authorization live on every call — n8n never needs Supabase access for this workflow at all.\n\n' +
    "No combined execution-summary node: n8n's cross-loop-iteration item linking does not reliably expose every " +
    "iteration's result to a single downstream node once a loop's done output fires (confirmed by direct testing — " +
    "`.all()` from that branch only resolved the last iteration). Each source/provider's real outcome is fully visible " +
    "per-iteration in each tier's own Record *Result node execution history in the n8n UI, sufficient for this " +
    'manually-reviewed, inactive workflow. Revisit if this is ever scheduled unattended and a single rollup ' +
    'notification becomes necessary.',
  [startTrigger, workflowConfiguration],
  { color: 4 }
);

const scopeLimitationNote = sticky(
  '### Dynamic source discovery (Phase 12) + three-tier orchestration (Phase 13)\n' +
    'One POST /api/internal/ingestion/list-sources call now returns three independent arrays this workflow fans out ' +
    'to below: (1) Tier-A company-specific ATS sources (Greenhouse/Lever/Workable/Ashby/Oracle Cloud Recruiting — ' +
    'findEligibleCompanySources.ts), (2) Tier-D enabled multi-company feeds (RemoteOK/Jobicy/Arbeitnow — ' +
    'multiCompanyFeedUrls.ts + providerConfig.ts), (3) Tier-B career-page extraction candidates ' +
    '(findCareerPageExtractionCandidates.ts). Each tier is its own modular loop with its own rate limit, converging on ' +
    'a shared endpoint per tier — no provider-specific matching/eligibility logic anywhere downstream of ingestion. ' +
    'See docs/PROVIDER_EXPANSION_IMPLEMENTATION.md for exact live-tested vs fixture-only status per provider. ' +
    'JSearch/Adzuna remain enabled:false (providerConfig.ts) — BLOCKED_ON_CREDENTIAL, no API key available. ' +
    "Bayt/GulfTalent/Indeed are enabled:true, implemented, and live-verified (Phase 21, docs/LEBANON_LIVE_SOURCE_" +
    "EXPANSION.md) — see the Apify multi-company branch below, not a no-op here. Their remaining gaps before " +
    'production activation are operational, not code: the Apify/Ingestion-Worker-Secret credentials still need ' +
    'manual binding in the n8n UI, and one small live reconfirmation run is wanted before this workflow goes live.',
  [listIngestionSources],
  { color: 6 }
);

const multiCompanyNote = sticky(
  '### Tier D: multi-company feeds (Phase 13)\n' +
    "RemoteOK/Jobicy/Arbeitnow are live, free, public APIs — no credential required. Each branch normalizes its own " +
    'raw response shape (RemoteOK: auto-split top-level array; Jobicy/Arbeitnow: Split Out + Aggregate their nested ' +
    "array field) down to one common {jobs:[...]} shape before converging on Call Multi-Company Batch Endpoint, " +
    'mirroring how Tier A above converges on Call Ingestion Batch Endpoint. First page only — see Fetch Multi-Company ' +
    "Feed's own note for why native pagination was skipped this phase.",
  [splitOutMultiCompanySources],
  { color: 5 }
);

const careerPageNote = sticky(
  '### Tier B: career-page extraction (Phase 13)\n' +
    'Fetches a real company_sources.official_careers_url and extracts schema.org JobPosting JSON-LD ' +
    '(extractCareerPageJobPostings.ts) — no headless browser, no Apify, no arbitrary scraping. Honest finding this ' +
    'phase: 0 of 11 sampled real candidates (Byblos Bank, touch Lebanon, Caritas Lebanon, Lebanese Red Cross, KPMG, ' +
    'Anghami, Whish Money, Mercy Corps, Deloitte, EY, Bank Audi) emit this markup on their recorded ' +
    'official_careers_url — that URL is almost always a landing/overview page, while JobPosting markup typically ' +
    "lives on an individual job's own detail page. The pipeline is real and live-tested end-to-end (fetch + extract " +
    'against a real page returns an honest 0, not an error) and will start yielding jobs automatically, with zero ' +
    'code changes, the moment any candidate page — or a future per-job-detail-page discovery step — actually emits ' +
    'this markup. See docs/PROVIDER_EXPANSION_IMPLEMENTATION.md.',
  [splitOutCareerPageCandidates],
  { color: 7 }
);

const apifyMultiCompanyNote = sticky(
  '### Apify-sourced multi-company feeds (Phase 21)\n' +
    'Bayt, GulfTalent, and Indeed — all three via Apify actor calls (POST run-sync-get-dataset-items), not a plain ' +
    'GET feed URL, so this branch is fully isolated from the Tier D loop above rather than an extra switch case. ' +
    'Static seed list, not dynamic discovery — these providers cannot be found the way ' +
    'getEnabledMultiCompanyFeedSources() finds RemoteOK/Jobicy/Arbeitnow. Real live-benchmark findings (schema drift, ' +
    'applyUrl provenance, per-market quirks) are in providers/bayt.ts, gulftalent.ts, indeed.ts and ' +
    'docs/LEBANON_LIVE_SOURCE_EXPANSION.md. Both new HTTP nodes need their credential bound manually in the n8n UI ' +
    "(a confirmed MCP tool limitation, not a project issue) — Call Apify Actor needs 'AI Job Guide - Apify', Call " +
    "Apify Batch Endpoint needs 'Ingestion Worker Secret'.",
  [apifyMultiCompanySourceSeeds],
  { color: 3 }
);

// ─────────────────────────────────────────────────────────────────────────
// LinkedIn/Bebity DISCOVERY (market expansion). Seventh independent branch,
// same "fresh off Workflow Configuration" pattern as the Apify branch
// above. Separate and independent from the LinkedIn ENRICHMENT branch
// below — Bebity discovers new LinkedIn jobs here; Data-Slayer enrichment
// only ever acts on LinkedIn jobs already persisted (by this branch or
// otherwise), never discovers anything itself (confirmed by Data-Slayer's
// own real input schema: job_ids_or_urls + include_hiring_team only).
// See src/lib/ingestion/linkedinDiscoverySeeds.ts for the real, bounded
// per-market seed list (Lebanon/Saudi/UAE/Qatar/Kuwait — rows:10 each,
// uniformly conservative since only Lebanon has ever been real-tested
// with Bebity) and its own cost derivation.
//
// Structurally inert while providerConfig.ts's linkedin.enabled stays
// false, at TWO independent layers: (1) List LinkedIn Discovery Seeds
// returns an empty seeds array in that state, so this loop has nothing to
// iterate and the paid Bebity actor call never fires; (2) even if it did,
// Call LinkedIn Discovery Batch Endpoint's own route re-checks
// isProviderEnabled("linkedin") live before writing anything. Neither
// layer trusts the other — same discipline already used for the
// enrichment branch's own list/apply endpoints.
// ─────────────────────────────────────────────────────────────────────────

const listLinkedInDiscoverySeeds = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'List LinkedIn Discovery Seeds',
    notes:
      "Returns the static, bounded per-market seed list (rows/locations/maxTotalChargeUsd) when providerConfig.ts's " +
      'linkedin.enabled is true, or an empty seeds array otherwise — same structurally-inert-while-disabled posture ' +
      'as List LinkedIn Enrichment Queue.',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/ingestion/list-linkedin-discovery-seeds"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ {} }}'),
      options: { timeout: 30000 },
    },
  },
  output: [
    {
      seeds: [
        {
          market: 'lebanon',
          actorUrl: 'https://api.apify.com/v2/acts/bebity~linkedin-jobs-scraper/run-sync-get-dataset-items',
          requestBody: { rows: 10, locations: ['Lebanon'], companyProfile: false, enrichCompany: false },
          refreshScope: 'linkedin:lebanon',
          maxJobsPerRun: 10,
          maxTotalChargeUsd: 0.01505,
        },
      ],
    },
  ],
});

const logListDiscoverySeedsFailure = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Log List Discovery Seeds Failure',
    notes: 'Terminal failure for this branch this run — nothing to loop over if seed listing itself failed. Never blocks the rest of ingestion (its own independent branch).',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'list-linkedin-discovery-seeds call failed' }}"), type: 'string' }] },
    },
  },
  output: [{ error: 'list-linkedin-discovery-seeds call failed' }],
});

const splitOutLinkedInDiscoverySeeds = node({
  type: 'n8n-nodes-base.splitOut',
  version: 1,
  config: {
    name: 'Split Out LinkedIn Discovery Seeds',
    parameters: { fieldToSplitOut: 'seeds' },
  },
  output: [
    {
      market: 'lebanon',
      actorUrl: 'https://api.apify.com/v2/acts/bebity~linkedin-jobs-scraper/run-sync-get-dataset-items',
      requestBody: { rows: 10, locations: ['Lebanon'], companyProfile: false, enrichCompany: false },
      refreshScope: 'linkedin:lebanon',
      maxJobsPerRun: 10,
      maxTotalChargeUsd: 0.01505,
    },
  ],
});

const loopLinkedInDiscoverySeeds = splitInBatches({
  version: 3,
  config: { name: 'Loop LinkedIn Discovery Seeds (Rate Limited)', parameters: { batchSize: 1 } },
  output: [
    {
      market: 'lebanon',
      actorUrl: 'https://api.apify.com/v2/acts/bebity~linkedin-jobs-scraper/run-sync-get-dataset-items',
      requestBody: { rows: 10, locations: ['Lebanon'], companyProfile: false, enrichCompany: false },
      refreshScope: 'linkedin:lebanon',
      maxJobsPerRun: 10,
      maxTotalChargeUsd: 0.01505,
    },
  ],
});

const callBebityActor = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call Bebity Actor',
    notes:
      "Credential 'AI Job Guide - Apify' must be bound manually in the n8n UI, same confirmed MCP tool limitation " +
      'noted on Call Apify Actor/Call Data-Slayer Actor. retryOnFail is deliberately false — Bebity is a real, ' +
      'confirmed PAY_PER_EVENT actor (free pricing-metadata GET, this phase); a run-sync-get-dataset-items call is ' +
      'a paid, non-idempotent external side effect, so a transport-level retry could start a second full-price ' +
      'actor run while the first is still executing/billing (AGENTS.md §18). maxTotalChargeUsd is appended ' +
      "dynamically per-seed, same pattern as Call Apify Actor's own cost-safety fix. No title/keyword/category " +
      "field is ever sent — broad discovery across every profession, per product rule; Bebity's own real confirmed " +
      'input has no such field anyway (rows/locations/companyProfile/enrichCompany only).',
    onError: 'continueErrorOutput',
    retryOnFail: false,
    parameters: {
      method: 'POST',
      url: expr("{{ $json.actorUrl + '?maxTotalChargeUsd=' + $json.maxTotalChargeUsd }}"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ $json.requestBody }}'),
      options: { timeout: 60000 },
    },
    credentials: { httpHeaderAuth: newCredential('AI Job Guide - Apify') },
  },
  output: [{ id: '4477362945', title: 'Accountant', companyName: 'Fixture Co', location: 'Lebanon' }],
});

const aggregateBebityJobs = node({
  type: 'n8n-nodes-base.aggregate',
  version: 1,
  config: {
    name: 'Aggregate Bebity Jobs',
    notes:
      "Bebity's run-sync-get-dataset-items returns a bare top-level array, same as every other Apify actor in this " +
      'workflow — n8n auto-splits it into one item per job, so this re-aggregates back into one {jobs:[...]} item ' +
      'before the batch endpoint call.',
    parameters: { aggregate: 'aggregateAllItemData', destinationFieldName: 'jobs', include: 'allFields' },
  },
  output: [{ jobs: [{ id: '4477362945', title: 'Accountant', companyName: 'Fixture Co', location: 'Lebanon' }] }],
});

const callLinkedInDiscoveryBatchEndpoint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call LinkedIn Discovery Batch Endpoint',
    notes:
      'Reuses the SAME shared run-multi-company-batch endpoint the Tier D and Apify branches use — linkedin is ' +
      "already in MULTI_COMPANY_SOURCE_TYPES' allowlist (parseMultiCompanyIngestionBatchRequest.ts). The endpoint " +
      "itself re-checks providerConfig.ts's linkedin.enabled live before writing anything (never trusts this " +
      "branch's own already-gated seed list), so this stays structurally inert end-to-end while disabled, not just " +
      "at the seed-listing step. Credential 'Ingestion Worker Secret' must be bound manually in the n8n UI, same " +
      'confirmed MCP tool limitation noted elsewhere.',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/ingestion/run-multi-company-batch"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '{{ {\n' +
          "  sourceType: 'linkedin',\n" +
          '  rawJobs: $json.jobs,\n' +
          "  maxJobsPerSource: $('Split Out LinkedIn Discovery Seeds').item.json.maxJobsPerRun,\n" +
          "  dryRun: $('Workflow Configuration').first().json.dryRun,\n" +
          "  refreshScope: $('Split Out LinkedIn Discovery Seeds').item.json.refreshScope\n" +
          '} }}'
      ),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
  },
  output: [{ outcome: 'succeeded', jobsFetched: 10, jobsValid: 10, jobsRejected: 0, jobsCreated: 10, jobsUpdated: 0, jobsClosed: 0, truncated: false }],
});

const LINKEDIN_DISCOVERY_MARKET_ASSIGNMENT = {
  id: 'market',
  name: 'market',
  value: expr("{{ $('Split Out LinkedIn Discovery Seeds').item.json.market }}"),
  type: 'string',
};

const buildLinkedInDiscoverySuccessResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build LinkedIn Discovery Success Result',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [LINKEDIN_DISCOVERY_MARKET_ASSIGNMENT, { id: 'succeeded', name: 'succeeded', value: expr("{{ $json.outcome === 'succeeded' }}"), type: 'boolean' }, { id: 'error', name: 'error', value: null, type: 'string' }],
      },
    },
  },
  output: [{ market: 'lebanon', outcome: 'succeeded', succeeded: true, error: null }],
});

const buildLinkedInDiscoveryFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build LinkedIn Discovery Failure Result',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          LINKEDIN_DISCOVERY_MARKET_ASSIGNMENT,
          { id: 'succeeded', name: 'succeeded', value: false, type: 'boolean' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'bebity actor or batch call failed' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ market: 'lebanon', succeeded: false, error: 'bebity actor or batch call failed' }],
});

const recordLinkedInDiscoverySourceResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Record LinkedIn Discovery Source Result',
    notes: 'Convergence point for this loop, same purpose as Record Apify Source Result above — one execution-history entry per market per run.',
    parameters: { mode: 'manual', includeOtherFields: true, assignments: { assignments: [] } },
  },
  output: [{ market: 'lebanon', succeeded: true }],
});

const linkedInDiscoveryRateLimitDelay = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'LinkedIn Discovery Rate Limit Delay',
    parameters: {
      resume: 'timeInterval',
      amount: expr("{{ $('Workflow Configuration').first().json.rateLimitDelaySeconds }}"),
      unit: 'seconds',
    },
  },
  output: [{ market: 'lebanon' }],
});

const linkedInDiscoveryNote = sticky(
  '### LinkedIn/Bebity discovery (market expansion)\n' +
    'Broad discovery across every profession — no title/keyword/category field exists in Bebity\'s own real confirmed ' +
    'input (rows/locations/companyProfile/enrichCompany only), and none is ever sent here, per product rule ' +
    '(ingestion stays role-agnostic; relevance belongs in CV/preferences/matching, never here). Five market seeds ' +
    '(Lebanon/Saudi/UAE/Qatar/Kuwait), each its own refresh_scope so stale-close never crosses market boundaries — ' +
    'only Lebanon has ever been real-tested with Bebity (two live pilots); the other four are structurally complete ' +
    'but UNVALIDATED and need their own small bounded real pilot before providerConfig.ts\'s linkedin.enabled is ' +
    'ever considered (AGENTS.md §35 rule 6/10). Reuses run-multi-company-batch (already allowlists linkedin) — no ' +
    'duplicate persistence model. Structurally inert while disabled, at two independent layers: the seed-listing ' +
    'endpoint returns empty, and the batch endpoint re-checks enabled live either way. Call Bebity Actor needs ' +
    "'AI Job Guide - Apify' bound manually in the n8n UI; Call LinkedIn Discovery Batch Endpoint needs 'Ingestion " +
    "Worker Secret' — same confirmed MCP tool limitation noted on every other HTTP node's credential in this workflow.",
  [listLinkedInDiscoverySeeds],
  { color: 9 }
);

// ─────────────────────────────────────────────────────────────────────────
// LinkedIn enrichment (data-slayer exact-ID pass). Seventh independent
// branch, same "fresh off Workflow Configuration" pattern as the Apify
// multi-company branch above. NOT a discovery branch — Bebity discovery
// lives in the separate branch directly above this one. This branch only
// ever acts on LinkedIn jobs
// however they already exist in the jobs table (source_type='linkedin',
// dedup_scope='type:linkedin') with work_arrangement still null and
// linkedin_enrichment_attempts under the cap — see
// src/lib/ingestion/findEligibleLinkedInEnrichmentJobs.ts,
// src/lib/ingestion/linkedinEnrichment.ts, and
// src/lib/ingestion/applyLinkedInEnrichmentBatch.ts for all real business
// logic (fully unit/DB tested); this branch is intentionally thin —
// list eligible ids -> confirm real price -> one bounded paid call ->
// forward the raw result untouched to the internal endpoint that
// reconciles and applies it. No fan-out loop: the list endpoint already
// bounds one call to ENRICHMENT_BATCH_SIZE (25) ids, so one run of this
// branch is already exactly one bounded batch.
// ─────────────────────────────────────────────────────────────────────────

// Every terminal path on this branch reports the exact same observability
// shape (19 counters + error — 13 from the original design, plus 6 added in
// the 2026-10-16 production-readiness audit: jobs_skipped_not_eligible,
// jobs_validation_failed, jobs_provider_failure, identity_mismatch_count,
// employment_type_conflict_count, schema_drift_warning_count — see Build
// Enrichment Success Result's own comment for why) — unset fields are
// always written as their 0/false default, never omitted, so a dashboard
// reading this run's Record node never sees an undefined field depending
// on which path was taken. n8n Workflow SDK code does not allow top-level
// helper functions (confirmed via validate_workflow — both a function
// declaration and an arrow-function const are rejected as unsupported
// syntax), so each node below writes its own full assignments array
// literal rather than calling a shared builder.

const listLinkedInEnrichmentQueue = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'List LinkedIn Enrichment Queue',
    notes:
      'Returns up to ENRICHMENT_BATCH_SIZE (25) already-persisted LinkedIn job external_ids where ' +
      'work_arrangement IS NULL AND linkedin_enrichment_attempts < 2 (src/lib/ingestion/findEligibleLinkedInEnrichmentJobs.ts). ' +
      "Always returns job_ids: [] while providerConfig.ts's linkedin.enabled stays false, so this entire branch is a " +
      'structural no-op in that state regardless of anything below it.',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/ingestion/list-linkedin-enrichment-queue"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ {} }}'),
      options: { timeout: 30000 },
    },
  },
  output: [{ job_ids: ['4467352986', '4476779325'] }],
});

const logListQueueFailure = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Log List Queue Failure',
    notes: 'Terminal — nothing to enrich this run if the queue listing itself failed. Never blocks the rest of ingestion (this is its own independent branch).',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'eligible_jobs', name: 'eligible_jobs', value: 0, type: 'number' },
          { id: 'jobs_sent_to_data_slayer', name: 'jobs_sent_to_data_slayer', value: 0, type: 'number' },
          { id: 'batch_count', name: 'batch_count', value: 0, type: 'number' },
          { id: 'pricing_aborted', name: 'pricing_aborted', value: false, type: 'boolean' },
          { id: 'actor_failed', name: 'actor_failed', value: false, type: 'boolean' },
          { id: 'items_requested', name: 'items_requested', value: 0, type: 'number' },
          { id: 'items_returned', name: 'items_returned', value: 0, type: 'number' },
          { id: 'items_missing', name: 'items_missing', value: 0, type: 'number' },
          { id: 'items_sent_to_enrichment_api', name: 'items_sent_to_enrichment_api', value: 0, type: 'number' },
          { id: 'enrichment_jobs_updated', name: 'enrichment_jobs_updated', value: 0, type: 'number' },
          { id: 'structured_wa_present', name: 'structured_wa_present', value: 0, type: 'number' },
          { id: 'structured_wa_empty', name: 'structured_wa_empty', value: 0, type: 'number' },
          { id: 'final_wa_unresolved', name: 'final_wa_unresolved', value: 0, type: 'number' },
          { id: 'jobs_skipped_not_eligible', name: 'jobs_skipped_not_eligible', value: 0, type: 'number' },
          { id: 'jobs_validation_failed', name: 'jobs_validation_failed', value: 0, type: 'number' },
          { id: 'jobs_provider_failure', name: 'jobs_provider_failure', value: 0, type: 'number' },
          { id: 'identity_mismatch_count', name: 'identity_mismatch_count', value: 0, type: 'number' },
          { id: 'employment_type_conflict_count', name: 'employment_type_conflict_count', value: 0, type: 'number' },
          { id: 'schema_drift_warning_count', name: 'schema_drift_warning_count', value: 0, type: 'number' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'list-linkedin-enrichment-queue call failed' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ eligible_jobs: 0, error: 'list-linkedin-enrichment-queue call failed' }],
});

const checkEligibleJobsExist = switchCase({
  version: 3.4,
  config: {
    name: 'Check Eligible Jobs Exist',
    parameters: {
      rules: {
        values: [
          {
            outputKey: 'has_jobs',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [{ leftValue: expr('{{ $json.job_ids.length }}'), operator: { type: 'number', operation: 'gt' }, rightValue: 0 }],
              combinator: 'and',
            },
          },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'no_jobs' },
    },
  },
  output: [{ job_ids: ['4467352986'] }],
});

const buildNoEligibleJobsResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build No Eligible Jobs Result',
    notes: 'Legitimate "nothing to do" outcome, not a failure — every counter stays at its 0/false default.',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'eligible_jobs', name: 'eligible_jobs', value: 0, type: 'number' },
          { id: 'jobs_sent_to_data_slayer', name: 'jobs_sent_to_data_slayer', value: 0, type: 'number' },
          { id: 'batch_count', name: 'batch_count', value: 0, type: 'number' },
          { id: 'pricing_aborted', name: 'pricing_aborted', value: false, type: 'boolean' },
          { id: 'actor_failed', name: 'actor_failed', value: false, type: 'boolean' },
          { id: 'items_requested', name: 'items_requested', value: 0, type: 'number' },
          { id: 'items_returned', name: 'items_returned', value: 0, type: 'number' },
          { id: 'items_missing', name: 'items_missing', value: 0, type: 'number' },
          { id: 'items_sent_to_enrichment_api', name: 'items_sent_to_enrichment_api', value: 0, type: 'number' },
          { id: 'enrichment_jobs_updated', name: 'enrichment_jobs_updated', value: 0, type: 'number' },
          { id: 'structured_wa_present', name: 'structured_wa_present', value: 0, type: 'number' },
          { id: 'structured_wa_empty', name: 'structured_wa_empty', value: 0, type: 'number' },
          { id: 'final_wa_unresolved', name: 'final_wa_unresolved', value: 0, type: 'number' },
          { id: 'jobs_skipped_not_eligible', name: 'jobs_skipped_not_eligible', value: 0, type: 'number' },
          { id: 'jobs_validation_failed', name: 'jobs_validation_failed', value: 0, type: 'number' },
          { id: 'jobs_provider_failure', name: 'jobs_provider_failure', value: 0, type: 'number' },
          { id: 'identity_mismatch_count', name: 'identity_mismatch_count', value: 0, type: 'number' },
          { id: 'employment_type_conflict_count', name: 'employment_type_conflict_count', value: 0, type: 'number' },
          { id: 'schema_drift_warning_count', name: 'schema_drift_warning_count', value: 0, type: 'number' },
          { id: 'error', name: 'error', value: null, type: 'string' },
        ],
      },
    },
  },
  output: [{ eligible_jobs: 0, error: null }],
});

// Free, read-only Apify metadata call — confirms the actor's real current
// price before any paid run, never trusting a hardcoded/previously-
// observed value (AGENTS.md §35 rule 4/5 — the same lesson from the real
// bebity $1.47/978-item cost incident this project already hit once).
const fetchDataSlayerPricing = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Data-Slayer Pricing Metadata',
    notes: "Free GET — never counts toward enrichment spend. Reconfirmed every run, not cached, so a real-world price change is caught before it is ever paid, not after.",
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 3000,
    parameters: {
      method: 'GET',
      url: 'https://api.apify.com/v2/acts/data-slayer~linkedin-job-scraper',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      options: { timeout: 15000 },
    },
    credentials: { httpHeaderAuth: newCredential('AI Job Guide - Apify') },
  },
  output: [{ data: { pricingInfos: [{ pricingPerEvent: { actorChargeEvents: { 'apify-default-dataset-item': { eventPriceUsd: 0.004 } } } }] } }],
});

const buildPricingMetadataFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Pricing Metadata Failure Result',
    notes: 'Could not confirm the actor is still safely priced — treated as pricing_aborted, same as price-too-high. Never assumes a stale/last-known price is still accurate.',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'eligible_jobs', name: 'eligible_jobs', value: expr("{{ $('List LinkedIn Enrichment Queue').item.json.job_ids.length }}"), type: 'number' },
          { id: 'jobs_sent_to_data_slayer', name: 'jobs_sent_to_data_slayer', value: 0, type: 'number' },
          { id: 'batch_count', name: 'batch_count', value: 0, type: 'number' },
          { id: 'pricing_aborted', name: 'pricing_aborted', value: true, type: 'boolean' },
          { id: 'actor_failed', name: 'actor_failed', value: false, type: 'boolean' },
          { id: 'items_requested', name: 'items_requested', value: 0, type: 'number' },
          { id: 'items_returned', name: 'items_returned', value: 0, type: 'number' },
          { id: 'items_missing', name: 'items_missing', value: 0, type: 'number' },
          { id: 'items_sent_to_enrichment_api', name: 'items_sent_to_enrichment_api', value: 0, type: 'number' },
          { id: 'enrichment_jobs_updated', name: 'enrichment_jobs_updated', value: 0, type: 'number' },
          { id: 'structured_wa_present', name: 'structured_wa_present', value: 0, type: 'number' },
          { id: 'structured_wa_empty', name: 'structured_wa_empty', value: 0, type: 'number' },
          { id: 'final_wa_unresolved', name: 'final_wa_unresolved', value: 0, type: 'number' },
          {
            id: 'error',
            name: 'error',
            value: expr("{{ 'could not confirm data-slayer pricing before a paid call: ' + ($json.error?.message ?? 'unknown error') }}"),
            type: 'string',
          },
        ],
      },
    },
  },
  output: [{ eligible_jobs: 2, pricing_aborted: true }],
});

// Mirrors linkedinEnrichment.ts's DATA_SLAYER_MAX_ACCEPTABLE_PRICE_PER_JOB_USD
// (0.005) — kept in sync by code review, the same way the Apify seed list
// above already mirrors providerConfig.ts's maxJobsPerRun values.
const checkDataSlayerPriceGate = switchCase({
  version: 3.4,
  config: {
    name: 'Check Data-Slayer Price',
    notes: 'price_ok only when the real, just-fetched price is <= $0.005/job (DATA_SLAYER_MAX_ACCEPTABLE_PRICE_PER_JOB_USD). Never a large slack multiplier.',
    parameters: {
      rules: {
        values: [
          {
            outputKey: 'price_ok',
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
              conditions: [
                {
                  leftValue: expr("{{ $json.data.pricingInfos.at(-1).pricingPerEvent.actorChargeEvents['apify-default-dataset-item'].eventPriceUsd }}"),
                  operator: { type: 'number', operation: 'lte' },
                  rightValue: 0.005,
                },
              ],
              combinator: 'and',
            },
          },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'price_too_high' },
    },
  },
  output: [{ data: { pricingInfos: [{ pricingPerEvent: { actorChargeEvents: { 'apify-default-dataset-item': { eventPriceUsd: 0.004 } } } }] } }],
});

const buildPricingAbortedResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Pricing Aborted Result',
    notes: 'Real price exceeded the configured maximum — actor is never called, jobs are left completely unchanged, no attempt is consumed.',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'eligible_jobs', name: 'eligible_jobs', value: expr("{{ $('List LinkedIn Enrichment Queue').item.json.job_ids.length }}"), type: 'number' },
          { id: 'jobs_sent_to_data_slayer', name: 'jobs_sent_to_data_slayer', value: 0, type: 'number' },
          { id: 'batch_count', name: 'batch_count', value: 0, type: 'number' },
          { id: 'pricing_aborted', name: 'pricing_aborted', value: true, type: 'boolean' },
          { id: 'actor_failed', name: 'actor_failed', value: false, type: 'boolean' },
          { id: 'items_requested', name: 'items_requested', value: 0, type: 'number' },
          { id: 'items_returned', name: 'items_returned', value: 0, type: 'number' },
          { id: 'items_missing', name: 'items_missing', value: 0, type: 'number' },
          { id: 'items_sent_to_enrichment_api', name: 'items_sent_to_enrichment_api', value: 0, type: 'number' },
          { id: 'enrichment_jobs_updated', name: 'enrichment_jobs_updated', value: 0, type: 'number' },
          { id: 'structured_wa_present', name: 'structured_wa_present', value: 0, type: 'number' },
          { id: 'structured_wa_empty', name: 'structured_wa_empty', value: 0, type: 'number' },
          { id: 'final_wa_unresolved', name: 'final_wa_unresolved', value: 0, type: 'number' },
          {
            id: 'error',
            name: 'error',
            value: expr(
              "{{ 'data-slayer price ' + $json.data.pricingInfos.at(-1).pricingPerEvent.actorChargeEvents['apify-default-dataset-item'].eventPriceUsd + ' exceeds configured maximum 0.005/job' }}"
            ),
            type: 'string',
          },
        ],
      },
    },
  },
  output: [{ eligible_jobs: 2, pricing_aborted: true }],
});

// Paid, non-idempotent call — retryOnFail is deliberately false (AGENTS.md
// §18/§35 rule 4/5: never auto-retry a non-idempotent paid action).
// maxItems/maxTotalChargeUsd are the real platform-level financial
// backstop — exact batch size, no slack multiplier, mirrors
// linkedinEnrichment.ts's computeMaxTotalChargeUsd exactly (batch size *
// 0.005, no padding). Credential 'AI Job Guide - Apify' must be bound
// manually in the n8n UI, same confirmed MCP tool limitation already
// noted on Call Apify Actor above.
const callDataSlayerActor = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call Data-Slayer Actor',
    onError: 'continueErrorOutput',
    retryOnFail: false,
    parameters: {
      method: 'POST',
      url: expr(
        "={{ 'https://api.apify.com/v2/acts/data-slayer~linkedin-job-scraper/run-sync-get-dataset-items?maxItems=' + $('List LinkedIn Enrichment Queue').item.json.job_ids.length + '&maxTotalChargeUsd=' + ($('List LinkedIn Enrichment Queue').item.json.job_ids.length * 0.005) }}"
      ),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr("{{ { job_ids_or_urls: $('List LinkedIn Enrichment Queue').item.json.job_ids, include_hiring_team: false } }}"),
      options: { timeout: 60000 },
    },
    credentials: { httpHeaderAuth: newCredential('AI Job Guide - Apify') },
  },
  output: [{ job_posting_id: '4467352986', workplace_types: ['ONSITE'], employment_status: 'Full-time' }],
});

const buildActorFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Actor Failure Result',
    notes:
      'Actor timeout/5xx/failed run/cost-cap-reached all land here via onError. No structurally valid response was received for any requested id, so nothing is forwarded to the apply endpoint at all — no attempt is consumed for any job, every one remains immediately retryable next run.',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'eligible_jobs', name: 'eligible_jobs', value: expr("{{ $('List LinkedIn Enrichment Queue').item.json.job_ids.length }}"), type: 'number' },
          { id: 'jobs_sent_to_data_slayer', name: 'jobs_sent_to_data_slayer', value: 0, type: 'number' },
          { id: 'batch_count', name: 'batch_count', value: 0, type: 'number' },
          { id: 'pricing_aborted', name: 'pricing_aborted', value: false, type: 'boolean' },
          { id: 'actor_failed', name: 'actor_failed', value: true, type: 'boolean' },
          { id: 'items_requested', name: 'items_requested', value: expr("{{ $('List LinkedIn Enrichment Queue').item.json.job_ids.length }}"), type: 'number' },
          { id: 'items_returned', name: 'items_returned', value: 0, type: 'number' },
          { id: 'items_missing', name: 'items_missing', value: 0, type: 'number' },
          { id: 'items_sent_to_enrichment_api', name: 'items_sent_to_enrichment_api', value: 0, type: 'number' },
          { id: 'enrichment_jobs_updated', name: 'enrichment_jobs_updated', value: 0, type: 'number' },
          { id: 'structured_wa_present', name: 'structured_wa_present', value: 0, type: 'number' },
          { id: 'structured_wa_empty', name: 'structured_wa_empty', value: 0, type: 'number' },
          { id: 'final_wa_unresolved', name: 'final_wa_unresolved', value: 0, type: 'number' },
          { id: 'jobs_skipped_not_eligible', name: 'jobs_skipped_not_eligible', value: 0, type: 'number' },
          { id: 'jobs_validation_failed', name: 'jobs_validation_failed', value: 0, type: 'number' },
          { id: 'jobs_provider_failure', name: 'jobs_provider_failure', value: 0, type: 'number' },
          { id: 'identity_mismatch_count', name: 'identity_mismatch_count', value: 0, type: 'number' },
          { id: 'employment_type_conflict_count', name: 'employment_type_conflict_count', value: 0, type: 'number' },
          { id: 'schema_drift_warning_count', name: 'schema_drift_warning_count', value: 0, type: 'number' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'data-slayer actor call failed' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ eligible_jobs: 2, actor_failed: true }],
});

// data-slayer's run-sync-get-dataset-items returns a bare top-level array
// (same shape as Lever / the other Apify actors above) — n8n auto-splits
// it into one item per job; this re-aggregates into one {items:[...]}
// item before reconciliation. aggregateAllItemData on zero input items
// still emits exactly one item with an empty array (a total actor
// success-but-empty-dataset case), so the chain below always continues.
const aggregateDataSlayerDataset = node({
  type: 'n8n-nodes-base.aggregate',
  version: 1,
  config: {
    name: 'Aggregate Data-Slayer Dataset',
    parameters: { aggregate: 'aggregateAllItemData', destinationFieldName: 'items', include: 'allFields' },
  },
  output: [{ items: [{ job_posting_id: '4467352986', workplace_types: ['ONSITE'] }] }],
});

// Forwards the requested id list and the raw dataset verbatim — all
// reconciliation (matching by job_posting_id, safe against a partial/
// reordered/short dataset) and all business logic (structured WA ->
// classifier -> null, employment-type gap-fill, bounded-retry attempt
// counting) happens entirely server-side
// (buildEnrichmentItemsFromDataset + applyLinkedInEnrichmentBatch) — never
// duplicated here. retryOnFail is false: a retry of this call against an
// already-applied dataset would double-count attempts for any job that
// resolved to null on the first (successfully applied, response-lost)
// attempt.
const callLinkedInEnrichmentBatchEndpoint = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call LinkedIn Enrichment Batch Endpoint',
    onError: 'continueErrorOutput',
    retryOnFail: false,
    parameters: {
      method: 'POST',
      url: expr("{{ $('Workflow Configuration').first().json.appBaseUrl }}/api/internal/ingestion/run-linkedin-enrichment-batch"),
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBearerAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr(
        '{{ {\n' +
          "  requestedJobIds: $('List LinkedIn Enrichment Queue').item.json.job_ids,\n" +
          '  rawDatasetItems: $json.items\n' +
          '} }}'
      ),
      options: { timeout: 30000 },
    },
    credentials: { httpBearerAuth: newCredential('Ingestion Worker Secret') },
  },
  // Full real response shape (applyLinkedInEnrichmentBatch.ts's
  // LinkedInEnrichmentBatchResult) — kept complete, not just the fields
  // Build Enrichment Success Result happens to read, so validate_workflow's
  // static expression-path check can see every field a future node might
  // need without a false "no predecessor outputs this field" warning.
  output: [
    {
      jobsRequested: 2,
      jobsSkippedNotEligible: 0,
      jobsUpdated: 2,
      jobsValidationFailed: 0,
      jobsProviderFailure: 0,
      identityMismatchCount: 0,
      structuredWaPresentCount: 1,
      structuredWaEmptyCount: 1,
      classifierFallbackUsedCount: 0,
      finalWaUnresolvedCount: 0,
      employmentTypeFilledCount: 0,
      employmentTypeConflictCount: 0,
      schemaDriftWarnings: [],
    },
  ],
});

const buildApplyCallFailureResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Apply Call Failure Result',
    notes: 'The actor call itself succeeded (a real dataset was fetched and paid for), but applying it to our own jobs table failed — e.g. a transient network error calling our own endpoint. The paid data is not lost: every requested id remains eligible (attempts untouched) for the next run to try applying again.',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'eligible_jobs', name: 'eligible_jobs', value: expr("{{ $('List LinkedIn Enrichment Queue').item.json.job_ids.length }}"), type: 'number' },
          {
            id: 'jobs_sent_to_data_slayer',
            name: 'jobs_sent_to_data_slayer',
            value: expr("{{ $('List LinkedIn Enrichment Queue').item.json.job_ids.length }}"),
            type: 'number',
          },
          { id: 'batch_count', name: 'batch_count', value: 1, type: 'number' },
          { id: 'pricing_aborted', name: 'pricing_aborted', value: false, type: 'boolean' },
          { id: 'actor_failed', name: 'actor_failed', value: false, type: 'boolean' },
          { id: 'items_requested', name: 'items_requested', value: expr("{{ $('List LinkedIn Enrichment Queue').item.json.job_ids.length }}"), type: 'number' },
          { id: 'items_returned', name: 'items_returned', value: expr("{{ $('Aggregate Data-Slayer Dataset').item.json.items.length }}"), type: 'number' },
          {
            id: 'items_missing',
            name: 'items_missing',
            value: expr("{{ $('List LinkedIn Enrichment Queue').item.json.job_ids.length - $('Aggregate Data-Slayer Dataset').item.json.items.length }}"),
            type: 'number',
          },
          { id: 'items_sent_to_enrichment_api', name: 'items_sent_to_enrichment_api', value: 0, type: 'number' },
          { id: 'enrichment_jobs_updated', name: 'enrichment_jobs_updated', value: 0, type: 'number' },
          { id: 'structured_wa_present', name: 'structured_wa_present', value: 0, type: 'number' },
          { id: 'structured_wa_empty', name: 'structured_wa_empty', value: 0, type: 'number' },
          { id: 'final_wa_unresolved', name: 'final_wa_unresolved', value: 0, type: 'number' },
          { id: 'jobs_skipped_not_eligible', name: 'jobs_skipped_not_eligible', value: 0, type: 'number' },
          { id: 'jobs_validation_failed', name: 'jobs_validation_failed', value: 0, type: 'number' },
          { id: 'jobs_provider_failure', name: 'jobs_provider_failure', value: 0, type: 'number' },
          { id: 'identity_mismatch_count', name: 'identity_mismatch_count', value: 0, type: 'number' },
          { id: 'employment_type_conflict_count', name: 'employment_type_conflict_count', value: 0, type: 'number' },
          { id: 'schema_drift_warning_count', name: 'schema_drift_warning_count', value: 0, type: 'number' },
          { id: 'error', name: 'error', value: expr("{{ $json.error?.message ?? 'run-linkedin-enrichment-batch call failed' }}"), type: 'string' },
        ],
      },
    },
  },
  output: [{ eligible_jobs: 2, items_requested: 2, items_returned: 2 }],
});

const buildEnrichmentSuccessResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Enrichment Success Result',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          { id: 'eligible_jobs', name: 'eligible_jobs', value: expr("{{ $('List LinkedIn Enrichment Queue').item.json.job_ids.length }}"), type: 'number' },
          {
            id: 'jobs_sent_to_data_slayer',
            name: 'jobs_sent_to_data_slayer',
            value: expr("{{ $('List LinkedIn Enrichment Queue').item.json.job_ids.length }}"),
            type: 'number',
          },
          { id: 'batch_count', name: 'batch_count', value: 1, type: 'number' },
          { id: 'pricing_aborted', name: 'pricing_aborted', value: false, type: 'boolean' },
          { id: 'actor_failed', name: 'actor_failed', value: false, type: 'boolean' },
          { id: 'items_requested', name: 'items_requested', value: expr("{{ $('List LinkedIn Enrichment Queue').item.json.job_ids.length }}"), type: 'number' },
          { id: 'items_returned', name: 'items_returned', value: expr("{{ $('Aggregate Data-Slayer Dataset').item.json.items.length }}"), type: 'number' },
          {
            id: 'items_missing',
            name: 'items_missing',
            value: expr("{{ $('List LinkedIn Enrichment Queue').item.json.job_ids.length - $('Aggregate Data-Slayer Dataset').item.json.items.length }}"),
            type: 'number',
          },
          {
            id: 'items_sent_to_enrichment_api',
            name: 'items_sent_to_enrichment_api',
            value: expr("{{ $('List LinkedIn Enrichment Queue').item.json.job_ids.length }}"),
            type: 'number',
          },
          { id: 'enrichment_jobs_updated', name: 'enrichment_jobs_updated', value: expr('{{ $json.jobsUpdated }}'), type: 'number' },
          { id: 'structured_wa_present', name: 'structured_wa_present', value: expr('{{ $json.structuredWaPresentCount }}'), type: 'number' },
          { id: 'structured_wa_empty', name: 'structured_wa_empty', value: expr('{{ $json.structuredWaEmptyCount }}'), type: 'number' },
          { id: 'final_wa_unresolved', name: 'final_wa_unresolved', value: expr('{{ $json.finalWaUnresolvedCount }}'), type: 'number' },
          // Added in the 2026-10-16 production-readiness audit: the apply
          // endpoint (applyLinkedInEnrichmentBatch.ts) already computes
          // these — a real degradation (many skipped/validation-failed/
          // provider-failure items) previously had no visible counter at
          // all, so a run with e.g. 20/25 skipped and 5 updated looked
          // identical in this node's own execution history to a clean
          // 5-requested/5-updated run. Pure pass-through, zero behavior
          // change — same discipline as the 13 counters above it.
          { id: 'jobs_skipped_not_eligible', name: 'jobs_skipped_not_eligible', value: expr('{{ $json.jobsSkippedNotEligible }}'), type: 'number' },
          { id: 'jobs_validation_failed', name: 'jobs_validation_failed', value: expr('{{ $json.jobsValidationFailed }}'), type: 'number' },
          { id: 'jobs_provider_failure', name: 'jobs_provider_failure', value: expr('{{ $json.jobsProviderFailure }}'), type: 'number' },
          { id: 'identity_mismatch_count', name: 'identity_mismatch_count', value: expr('{{ $json.identityMismatchCount }}'), type: 'number' },
          { id: 'employment_type_conflict_count', name: 'employment_type_conflict_count', value: expr('{{ $json.employmentTypeConflictCount }}'), type: 'number' },
          { id: 'schema_drift_warning_count', name: 'schema_drift_warning_count', value: expr('{{ $json.schemaDriftWarnings.length }}'), type: 'number' },
          { id: 'error', name: 'error', value: null, type: 'string' },
        ],
      },
    },
  },
  output: [
    {
      eligible_jobs: 2,
      enrichment_jobs_updated: 2,
      structured_wa_present: 1,
      structured_wa_empty: 1,
      final_wa_unresolved: 0,
      jobs_skipped_not_eligible: 0,
      jobs_validation_failed: 0,
      jobs_provider_failure: 0,
      identity_mismatch_count: 0,
      employment_type_conflict_count: 0,
      schema_drift_warning_count: 0,
      error: null,
    },
  ],
});

const recordLinkedInEnrichmentResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Record LinkedIn Enrichment Result',
    notes: 'Pure convergence point — every path (no eligible jobs, list failure, pricing-metadata failure, price too high, actor failure, apply-call failure, success) lands here with the same observability shape, visible in this node'+"'"+'s own execution history in the n8n UI.',
    parameters: { mode: 'manual', includeOtherFields: true, assignments: { assignments: [] } },
  },
  output: [{ eligible_jobs: 2, enrichment_jobs_updated: 2, error: null }],
});

const linkedInEnrichmentNote = sticky(
  '### LinkedIn enrichment — data-slayer exact-ID pass\n' +
    'EXACT_ID_ENRICHMENT_ONLY, never a discovery source (its real input schema is only job_ids_or_urls + ' +
    'include_hiring_team — confirmed live, no keyword/location field exists). Bebity discovery now has its own ' +
    'separate branch (LinkedIn/Bebity discovery sticky note above) — the two remain fully independent; this ' +
    'branch acts purely on whatever LinkedIn jobs already exist in the jobs table, from any source. Work-arrangement value ' +
    'priority is QUALITY-FIRST and deliberately NOT classifier-gated for cost (a dated product decision — see ' +
    'docs/LEBANON_LIVE_SOURCE_EXPANSION.md): every eligible job (work_arrangement null, attempts < 2) is sent to ' +
    'data-slayer; structured workplace_types wins when present, classifyWorkArrangementFromText.ts is the fallback, ' +
    'null otherwise. Real price is re-fetched and checked every run (never cached) before the one paid call — ' +
    'the same lesson as the real bebity $1.47/978-item incident. No loop/fan-out: List LinkedIn Enrichment Queue ' +
    'already bounds one run to <=25 ids, so one data-slayer call handles the whole batch; more eligible jobs than ' +
    'that are picked up by a later run. Both new Apify-facing HTTP nodes need their credential bound manually in ' +
    "the n8n UI (same confirmed MCP tool limitation noted on the Apify multi-company branch) — Fetch Data-Slayer " +
    "Pricing Metadata and Call Data-Slayer Actor both need 'AI Job Guide - Apify'. NOT regenerated into this " +
    'workflow'+"'"+'s matching .json this phase — see this feature'+"'"+'s own implementation report for why (the only ' +
    'available JSON-generation/live-write tool is create_workflow_from_code, which this phase was explicitly ' +
    'instructed never to use). This .ts source HAS been run through the read-only validate_workflow MCP tool ' +
    '(confirmed non-destructive) and passed (valid:true, 76 nodes) — see this feature'+"'"+'s own validation report. ' +
    'That same check caught a real SDK-syntax violation this branch originally introduced (a top-level helper ' +
    'function — both a function declaration and an arrow-function const are rejected by the SDK'+"'"+'s code format), ' +
    'now fixed by inlining each terminal node'+"'"+'s assignments array literally instead of sharing a builder.',
  [listLinkedInEnrichmentQueue],
  { color: 2 }
);

export default workflow('ai-job-agent-01-job-ingestion', 'AI Job Guide / 01 Job Ingestion')
  .add(startTrigger)
  .to(workflowConfiguration)
  .to(listIngestionSources.onError(logListSourcesFailure))
  .to(splitOutSources)

  // Daily production cadence — independent entry point, converges on the
  // exact same Workflow Configuration node the Manual Trigger feeds (see
  // dailyBeirutTrigger's own comment for the timezone caveat).
  .add(dailyBeirutTrigger)
  .to(workflowConfiguration)
  .to(
    loopSources.onEachBatch(
      fetchSourceJobs
        .onError(buildFetchFailureResult)
        .to(
          extractJobsByAtsType
            .onCase(0, extractGreenhouseJobs.onError(buildFetchFailureResult).to(callIngestionBatchEndpoint))
            .onCase(1, aggregateLeverJobs.to(extractLeverJobs.onError(buildFetchFailureResult).to(callIngestionBatchEndpoint)))
            .onCase(2, extractWorkableJobs.onError(buildFetchFailureResult).to(callIngestionBatchEndpoint))
            .onCase(3, extractAshbyJobs.onError(buildFetchFailureResult).to(callIngestionBatchEndpoint))
            .onCase(
              4,
              prepareOracleHcmPageState.onError(buildFetchFailureResult).to(
                checkOracleHcmPage1Complete
                  .onCase(0, callIngestionBatchEndpoint)
                  .onCase(
                    1,
                    prepareOracleHcmNextPageRequest
                      .onError(buildOracleHcmSafetyFallbackState.to(callIngestionBatchEndpoint))
                      .to(carryForwardOracleHcmPageState.input(0))
                  )
              )
            )
            .onCase(5, buildUnsupportedSourceResult.to(recordSourceResult))
        )
    )
  )
  .add(callIngestionBatchEndpoint.onError(buildEndpointFailureResult))
  .to(buildSuccessResult)
  .to(recordSourceResult)
  .add(buildFetchFailureResult)
  .to(recordSourceResult)
  .add(buildEndpointFailureResult)
  .to(recordSourceResult)
  .add(recordSourceResult)
  .to(rateLimitDelay)
  .to(nextBatch(loopSources))

  // Oracle HCM bounded pagination — the direct, self-referencing cycle
  // (2026-10-23 corrective fix, see Prepare Oracle HCM Next Page Request's
  // own header comment above for why). Wired as separate .add() statements
  // reusing the same node instances already entered via Extract Jobs By
  // ATS Type's oracle_hcm case above — the same convention this workflow
  // already uses for every other multi-entry-point node (e.g.
  // recordSourceResult, callIngestionBatchEndpoint themselves).
  .add(
    prepareOracleHcmNextPageRequest.to(
      fetchOracleHcmNextPage.onError(carryForwardOracleHcmPageState.input(1)).to(carryForwardOracleHcmPageState.input(1))
    )
  )
  .add(
    carryForwardOracleHcmPageState.to(
      mergeClassifyOracleHcmPage.onError(buildOracleHcmSafetyFallbackState).to(
        routeOracleHcmPageOutcome
          .onCase(0, prepareOracleHcmNextPageRequest)
          .onCase(1, buildOracleHcmPaginationBoundExhausted.to(callIngestionBatchEndpoint))
          .onCase(2, callIngestionBatchEndpoint)
      )
    )
  )

  // Tier D: multi-company feeds — second independent branch off List Ingestion Sources' success output.
  .add(listIngestionSources)
  .to(splitOutMultiCompanySources)
  .to(
    loopMultiCompanySources.onEachBatch(
      fetchMultiCompanyFeed
        .onError(buildMultiCompanyFailureResult)
        .to(
          extractRawJobsByProviderType
            .onCase(0, aggregateRemoteOkJobs.to(callMultiCompanyBatchEndpoint))
            .onCase(1, splitOutJobicyJobs.to(aggregateJobicyJobs.to(callMultiCompanyBatchEndpoint)))
            .onCase(2, splitOutArbeitnowJobs.to(filterArbeitnowRemote.to(aggregateArbeitnowJobs.to(callMultiCompanyBatchEndpoint))))
            .onCase(3, buildMultiCompanyFailureResult)
        )
    )
  )
  .add(callMultiCompanyBatchEndpoint.onError(buildMultiCompanyFailureResult))
  .to(buildMultiCompanySuccessResult)
  .to(recordMultiCompanySourceResult)
  .add(buildMultiCompanyFailureResult)
  .to(recordMultiCompanySourceResult)
  .add(recordMultiCompanySourceResult)
  .to(multiCompanyRateLimitDelay)
  .to(nextBatch(loopMultiCompanySources))

  // Tier B: career-page extraction — third independent branch off List Ingestion Sources' success output.
  .add(listIngestionSources)
  .to(splitOutCareerPageCandidates)
  .to(
    loopCareerPageCandidates.onEachBatch(
      fetchCareerPageHtml
        .onError(buildCareerPageFailureResult)
        .to(callExtractCareerPageJobsEndpoint.onError(buildCareerPageFailureResult).to(callCareerPageIngestionBatchEndpoint))
    )
  )
  .add(callCareerPageIngestionBatchEndpoint.onError(buildCareerPageFailureResult))
  .to(buildCareerPageSuccessResult)
  .to(recordCareerPageSourceResult)
  .add(buildCareerPageFailureResult)
  .to(recordCareerPageSourceResult)
  .add(recordCareerPageSourceResult)
  .to(careerPageRateLimitDelay)
  .to(nextBatch(loopCareerPageCandidates))

  // Apify-sourced multi-company feeds (Phase 21): Bayt/Indeed — fourth
  // independent branch, static seeds rather than off List Ingestion
  // Sources (these providers are not dynamically discoverable). GulfTalent
  // moved to its own async/polling branch below (reliability fix).
  .add(workflowConfiguration)
  .to(apifyMultiCompanySourceSeeds)
  .to(splitOutApifySources)
  .to(loopApifySources.onEachBatch(callApifyActor.onError(buildApifyFailureResult).to(aggregateApifyJobs.to(callApifyBatchEndpoint))))
  .add(callApifyBatchEndpoint.onError(buildApifyFailureResult))
  .to(buildApifySuccessResult)
  .to(recordApifySourceResult)
  .add(buildApifyFailureResult)
  .to(recordApifySourceResult)
  .add(recordApifySourceResult)
  .to(apifyRateLimitDelay)
  .to(nextBatch(loopApifySources))

  // GulfTalent — fifth independent branch, async + bounded polling
  // (reliability fix — see the sticky/notes above Loop GulfTalent Sources
  // for the real evidence this is based on). Fresh off Workflow
  // Configuration, fully isolated from the Bayt/Indeed branch above —
  // a GulfTalent failure/timeout here can never affect Bayt/Indeed, and
  // vice versa.
  .add(workflowConfiguration)
  .to(gulfTalentSourceSeeds)
  .to(splitOutGulfTalentSources)
  .to(
    loopGulfTalentSources.onEachBatch(
      startGulfTalentActorRun.onError(buildGulfTalentStartFailureResult).to(
        prepareGulfTalentPollAttempts.to(
          checkGulfTalentActorStartRunIdValid
            .onCase(
              0,
              splitOutGulfTalentPollAttempts.to(
                loopGulfTalentPoll.onEachBatch(
                  gulfTalentPollDelay.to(
                    pollGulfTalentRunStatus.onError(nextBatch(loopGulfTalentPoll)).to(
                      checkGulfTalentPollTerminal
                        .onCase(
                          0,
                          checkGulfTalentTerminalDatasetIdValid
                            .onCase(0, fetchGulfTalentDatasetItems.onError(buildGulfTalentDatasetFetchFailureResult).to(aggregateGulfTalentJobs.to(callGulfTalentBatchEndpoint)))
                            .onCase(1, buildGulfTalentInvalidDatasetIdResult)
                        )
                        .onCase(1, buildGulfTalentTerminalFailureResult)
                        .onCase(2, nextBatch(loopGulfTalentPoll))
                    )
                  )
                )
              )
            )
            .onCase(1, buildGulfTalentInvalidActorStartIdResult)
        )
      )
    )
  )
  .add(loopGulfTalentPoll.onDone(buildGulfTalentPollTimeoutResult))
  .add(callGulfTalentBatchEndpoint.onError(buildGulfTalentBatchFailureResult))
  .to(buildGulfTalentSuccessResult)
  .to(recordGulfTalentSourceResult)
  .add(buildGulfTalentStartFailureResult)
  .to(recordGulfTalentSourceResult)
  .add(buildGulfTalentInvalidActorStartIdResult)
  .to(recordGulfTalentSourceResult)
  .add(buildGulfTalentTerminalFailureResult)
  .to(recordGulfTalentSourceResult)
  .add(buildGulfTalentInvalidDatasetIdResult)
  .to(recordGulfTalentSourceResult)
  .add(buildGulfTalentPollTimeoutResult)
  .to(recordGulfTalentSourceResult)
  .add(buildGulfTalentDatasetFetchFailureResult)
  .to(recordGulfTalentSourceResult)
  .add(buildGulfTalentBatchFailureResult)
  .to(recordGulfTalentSourceResult)
  .add(recordGulfTalentSourceResult)
  .to(gulfTalentRateLimitDelay)
  .to(nextBatch(loopGulfTalentSources))

  // LinkedIn/Bebity discovery (market expansion) — seventh independent
  // branch, fresh off Workflow Configuration like the Apify branch above.
  // Structurally inert while providerConfig.ts's linkedin.enabled stays
  // false — see linkedInDiscoveryNote for the full reasoning.
  .add(workflowConfiguration)
  .to(listLinkedInDiscoverySeeds.onError(logListDiscoverySeedsFailure))
  .to(splitOutLinkedInDiscoverySeeds)
  .to(loopLinkedInDiscoverySeeds.onEachBatch(callBebityActor.onError(buildLinkedInDiscoveryFailureResult).to(aggregateBebityJobs.to(callLinkedInDiscoveryBatchEndpoint))))
  .add(callLinkedInDiscoveryBatchEndpoint.onError(buildLinkedInDiscoveryFailureResult))
  .to(buildLinkedInDiscoverySuccessResult)
  .to(recordLinkedInDiscoverySourceResult)
  .add(buildLinkedInDiscoveryFailureResult)
  .to(recordLinkedInDiscoverySourceResult)
  .add(recordLinkedInDiscoverySourceResult)
  .to(linkedInDiscoveryRateLimitDelay)
  .to(nextBatch(loopLinkedInDiscoverySeeds))

  // LinkedIn enrichment (data-slayer exact-ID pass) — eighth independent
  // branch, fresh off Workflow Configuration like the Apify branch above.
  // No loop: List LinkedIn Enrichment Queue already bounds one run to a
  // single <=25-id batch.
  .add(workflowConfiguration)
  .to(listLinkedInEnrichmentQueue.onError(logListQueueFailure))
  .to(
    checkEligibleJobsExist
      .onCase(
        0,
        fetchDataSlayerPricing.onError(buildPricingMetadataFailureResult).to(
          checkDataSlayerPriceGate
            .onCase(
              0,
              callDataSlayerActor
                .onError(buildActorFailureResult)
                .to(aggregateDataSlayerDataset.to(callLinkedInEnrichmentBatchEndpoint.onError(buildApplyCallFailureResult).to(buildEnrichmentSuccessResult)))
            )
            .onCase(1, buildPricingAbortedResult)
        )
      )
      .onCase(1, buildNoEligibleJobsResult)
  )
  .add(logListQueueFailure)
  .to(recordLinkedInEnrichmentResult)
  .add(buildNoEligibleJobsResult)
  .to(recordLinkedInEnrichmentResult)
  .add(buildPricingMetadataFailureResult)
  .to(recordLinkedInEnrichmentResult)
  .add(buildPricingAbortedResult)
  .to(recordLinkedInEnrichmentResult)
  .add(buildActorFailureResult)
  .to(recordLinkedInEnrichmentResult)
  .add(buildApplyCallFailureResult)
  .to(recordLinkedInEnrichmentResult)
  .add(buildEnrichmentSuccessResult)
  .to(recordLinkedInEnrichmentResult)
  .add(recordLinkedInEnrichmentResult)

  .add(overviewNote)
  .add(scopeLimitationNote)
  .add(multiCompanyNote)
  .add(careerPageNote)
  .add(apifyMultiCompanyNote)
  .add(linkedInDiscoveryNote)
  .add(linkedInEnrichmentNote);
