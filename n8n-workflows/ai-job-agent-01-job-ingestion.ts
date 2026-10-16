import { workflow, node, trigger, sticky, splitInBatches, nextBatch, switchCase, newCredential, expr } from '@n8n/workflow-sdk';

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

// Phase 16. Oracle's recruitingCEJobRequisitions response nests the real job
// list at items[0].requisitionList and carries no candidate-facing URL of
// its own (only internal hcmRestApi self-links) — the real, public apply
// URL lives at a sibling path, {host}/hcmUI/CandidateExperience/en/sites/
// {site}/job/{id}, confirmed live this phase (docs/LEBANON_GULF_SOURCE_RESEARCH.md
// §3). This expression derives that host+site from the same feed_url
// Fetch Source Jobs already used, and stamps it onto every raw job so
// providers/oracle-hcm.ts (a plain (raw) => RawProviderJob function, no
// per-batch context parameter) can build a real applicationUrl without
// inventing one.
const extractOracleHcmJobs = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Extract Oracle HCM Jobs',
    notes:
      'Phase 16. Confirmed live against a real registry tenant (AUBMC, Lebanon) — a direct unauthenticated GET to ' +
      'recruitingCEJobRequisitions returned real job data, and the derived candidate-facing URL returned a real 200 job page. ' +
      'See providers/oracle-hcm.ts and deriveAtsFeedUrl.ts.',
    onError: 'continueErrorOutput',
    parameters: {
      mode: 'manual',
      assignments: {
        assignments: [
          {
            id: 'rawJobs',
            name: 'rawJobs',
            value: expr(
              '={{ (() => {\n' +
                "  const feedUrl = $('Split Out Sources').item.json.feed_url;\n" +
                '  const m = feedUrl.match(/^https:\\/\\/([^/]+)\\/hcmRestApi.*siteNumber=([A-Za-z0-9_]+)/);\n' +
                '  const candidateSiteUrl = m ? `https://${m[1]}/hcmUI/CandidateExperience/en/sites/${m[2]}` : null;\n' +
                '  const list = $json.items?.[0]?.requisitionList ?? [];\n' +
                '  return list.map((job) => ({ ...job, candidateSiteUrl }));\n' +
                '})() }}'
            ),
            type: 'array',
          },
        ],
      },
    },
  },
  output: [{ rawJobs: [] }],
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
          '  rawJobs: $json.rawJobs,\n' +
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
      'Static seed list — bounded to the real markets live-benchmarked this phase (Bayt: Lebanon; GulfTalent: Saudi ' +
      'Arabia + UAE/Dubai; Indeed: UAE/Dubai only — Indeed and GulfTalent both real-confirmed to have no Lebanon ' +
      "country option). Qatar/Kuwait not yet included — add once benchmarked. refresh_scope (Phase 22 fix): a real " +
      'paid-pilot run proved these two GulfTalent entries share one source_type but are independently-complete ' +
      "query partitions — without a distinct refresh_scope per entry, the AE/Dubai call's stale-close sweep wrongly " +
      "closed the SA call's jobs as 'not seen'. Bayt/Indeed keep refresh_scope: null (one undivided partition each " +
      'today, unchanged behavior) — only add a value here if a second independent query is ever added for them. ' +
      "max_jobs_per_run (2026-10-02 fix): each seed's own requested ingestion cap, read by Call Apify Batch " +
      'Endpoint instead of the global Workflow Configuration.maxJobsPerSource — the global 5 was far below every ' +
      'real paid batch size (25/15/15/15) and falsely truncated all four. Still clamped server-side against ' +
      "providerConfig.ts's maxJobsPerRun (40 for all three) — this value can only ever be lowered by the server, " +
      'never raised.',
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
          },
          {
            provider_type: 'gulftalent',
            actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~gulftalent-scraper/run-sync-get-dataset-items',
            request_body: { country: 'SA', maxResults: 15 },
            refresh_scope: 'country:SA',
            max_jobs_per_run: 15,
          },
          {
            provider_type: 'gulftalent',
            actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~gulftalent-scraper/run-sync-get-dataset-items',
            request_body: { country: 'AE', location: 'Dubai', maxResults: 15 },
            refresh_scope: 'country:AE:location:Dubai',
            max_jobs_per_run: 15,
          },
          {
            provider_type: 'indeed',
            actor_url: 'https://api.apify.com/v2/acts/curious_coder~indeed-scraper/run-sync-get-dataset-items',
            request_body: { country: 'ae', location: 'Dubai', count: 15 },
            refresh_scope: null,
            max_jobs_per_run: 15,
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
  output: [{ provider_type: 'bayt', actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~bayt-scraper/run-sync-get-dataset-items', request_body: { country: 'LB', maxResults: 25 } }],
});

const loopApifySources = splitInBatches({
  version: 3,
  config: { name: 'Loop Apify Sources (Rate Limited)', parameters: { batchSize: 1 } },
  output: [{ provider_type: 'bayt', actor_url: 'https://api.apify.com/v2/acts/blackfalcondata~bayt-scraper/run-sync-get-dataset-items', request_body: { country: 'LB', maxResults: 25 } }],
});

const callApifyActor = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Call Apify Actor',
    notes:
      "Credential 'AI Job Guide - Apify' must be bound manually in the n8n UI — programmatic credential binding for " +
      'generic-auth types on this node is a confirmed n8n MCP tool limitation (reported separately), not a project issue.',
    onError: 'continueErrorOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    parameters: {
      method: 'POST',
      url: expr('{{ $json.actor_url }}'),
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
// LinkedIn enrichment (data-slayer exact-ID pass). Fifth independent
// branch, same "fresh off Workflow Configuration" pattern as the Apify
// multi-company branch above. NOT a discovery branch — Bebity itself has
// no branch in this workflow yet (LinkedIn discovery remains
// providerConfig.ts enabled:false, pending its own separate, explicitly-
// approved integration). This branch only ever acts on LinkedIn jobs
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
    'include_hiring_team — confirmed live, no keyword/location field exists). Bebity itself has no branch in this ' +
    'workflow yet, so this branch acts purely on whatever LinkedIn jobs already exist in the jobs table — a ' +
    'future, separately-approved Bebity discovery branch and this one are independent. Work-arrangement value ' +
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
            .onCase(4, extractOracleHcmJobs.onError(buildFetchFailureResult).to(callIngestionBatchEndpoint))
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

  // Apify-sourced multi-company feeds (Phase 21): Bayt/GulfTalent/Indeed —
  // fourth independent branch, static seeds rather than off List Ingestion
  // Sources (these providers are not dynamically discoverable).
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

  // LinkedIn enrichment (data-slayer exact-ID pass) — fifth independent
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
  .add(linkedInEnrichmentNote);
