import { workflow, node, trigger, sticky, splitInBatches, nextBatch, switchCase, newCredential, expr } from '@n8n/workflow-sdk';

const startTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Start Job Ingestion Run' },
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
        maxJobsPerSource: 5,
        rateLimitDelaySeconds: 2,
        dryRun: true,
      },
    },
  },
  output: [{ appBaseUrl: 'http://host.docker.internal:3000', maxJobsPerSource: 5, rateLimitDelaySeconds: 2, dryRun: true }],
});

const listIngestionSources = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'List Ingestion Sources',
    notes:
      'Discovers verified, automatable company_sources rows dynamically — replaces the old hardcoded 4-source list ' +
      '(Phase 12). See src/lib/ingestion/findEligibleCompanySources.ts.',
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
  output: [{ sources: [{ source_id: 'sr-sa-alpaca', ats_type: 'greenhouse', feed_url: 'https://boards-api.greenhouse.io/v1/boards/alpaca/jobs?content=true' }] }],
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

const extractLeverJobs = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Extract Lever Jobs',
    notes: "Lever's postings API returns a bare top-level array — the whole response body IS the jobs list (docs/job-ingestion-pilot.md §5).",
    onError: 'continueErrorOutput',
    parameters: {
      mode: 'manual',
      assignments: { assignments: [{ id: 'rawJobs', name: 'rawJobs', value: expr('{{ $json }}'), type: 'array' }] },
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

const overviewNote = sticky(
  '### AI Job Agent / 01 Job Ingestion\n' +
    'Manual trigger, stays inactive until a human reviews a `local_pilot`-equivalent run (dryRun:false) and decides on a schedule. ' +
    'n8n owns provider HTTP calls + retry/backoff (native `retryOnFail`) + per-source rate limiting; ALL validation, ' +
    'field mapping, dedup identity, idempotent persistence, and stale-close safety live in src/lib/ingestion/* (Phase 03) ' +
    "behind POST /api/internal/ingestion/run-batch, which also re-verifies each source's company_sources.review_status " +
    'live on every call — n8n never needs Supabase access for this workflow at all.\n\n' +
    "No combined execution-summary node: n8n's cross-loop-iteration item linking does not reliably expose every " +
    "iteration's result to a single downstream node once Loop Sources (Rate Limited)'s done output fires (confirmed " +
    'by direct testing — `.all()` from that branch only resolved the last iteration). Each source\'s real outcome is ' +
    "fully visible per-iteration in Record Source Result's own execution history in the n8n UI, sufficient for this " +
    'manually-reviewed, inactive workflow. Revisit if this is ever scheduled unattended and a single rollup ' +
    'notification becomes necessary.',
  [startTrigger, workflowConfiguration],
  { color: 4 }
);

const scopeLimitationNote = sticky(
  '### Dynamic source discovery (Phase 12)\n' +
    'Sources are now discovered live from company_sources via POST /api/internal/ingestion/list-sources ' +
    '(src/lib/ingestion/findEligibleCompanySources.ts + deriveAtsFeedUrl.ts), replacing the old hardcoded 4-source ' +
    "list. Eligibility: review_status='verified' AND automation_eligibility='suitable_public_ats' AND a " +
    'Greenhouse/Lever/Workable feed URL derivable from official_careers_url. Remaining ceiling: many verified ' +
    "ATS-suitable rows embed their board on the company's own domain rather than linking the ATS host directly, so " +
    'URL derivation cannot resolve every row — see docs/SOURCE_COVERAGE_AND_PROVIDER_EXPANSION_AUDIT.md (Phase 12) ' +
    "for the exact count and per-market breakdown. Each returned source's review_status/automation_eligibility is " +
    'still re-verified live, per source, inside runIngestionBatch() before anything is written.',
  [listIngestionSources],
  { color: 6 }
);

export default workflow('ai-job-agent-01-job-ingestion', 'AI Job Agent / 01 Job Ingestion')
  .add(startTrigger)
  .to(workflowConfiguration)
  .to(listIngestionSources.onError(logListSourcesFailure))
  .to(splitOutSources)
  .to(
    loopSources.onEachBatch(
      fetchSourceJobs
        .onError(buildFetchFailureResult)
        .to(
          extractJobsByAtsType
            .onCase(0, extractGreenhouseJobs.onError(buildFetchFailureResult).to(callIngestionBatchEndpoint))
            .onCase(1, extractLeverJobs.onError(buildFetchFailureResult).to(callIngestionBatchEndpoint))
            .onCase(2, extractWorkableJobs.onError(buildFetchFailureResult).to(callIngestionBatchEndpoint))
            .onCase(3, buildUnsupportedSourceResult.to(recordSourceResult))
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
  .add(overviewNote)
  .add(scopeLimitationNote);
